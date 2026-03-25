#!/usr/bin/env python3
"""
SAM Service for LabelEditor-for-VSCode
HTTP server providing SAM (Segment Anything Model) encoder/decoder inference.
Supports both SAM1 and SAM2 model variants via auto-detection.
"""

import argparse
import json
import os
import sys
import time
from copy import deepcopy
from http.server import HTTPServer, BaseHTTPRequestHandler

import cv2
import numpy as np
import onnxruntime


def imread_unicode(img_path, flags=cv2.IMREAD_COLOR):
    """Read image supporting unicode/Chinese file paths."""
    data = np.fromfile(img_path, dtype=np.uint8)
    return cv2.imdecode(data, flags)


# ---------------------------------------------------------------------------
# SAM1 Model (SegmentAnythingONNX - from samexporter)
# ---------------------------------------------------------------------------

class SAM1Model:
    """SAM1 encoder/decoder wrapper."""

    def __init__(self, encoder_path, decoder_path, providers):
        self.target_size = 1024
        self.input_size = (684, 1024)

        self.encoder_session = onnxruntime.InferenceSession(encoder_path, providers=providers)
        self.encoder_input_name = self.encoder_session.get_inputs()[0].name
        self.decoder_session = onnxruntime.InferenceSession(decoder_path, providers=providers)

    @staticmethod
    def get_preprocess_shape(oldh, oldw, long_side_length):
        scale = long_side_length * 1.0 / max(oldh, oldw)
        newh, neww = oldh * scale, oldw * scale
        return int(newh + 0.5), int(neww + 0.5)

    def apply_coords(self, coords, original_size, target_length):
        old_h, old_w = original_size
        new_h, new_w = self.get_preprocess_shape(old_h, old_w, target_length)
        coords = deepcopy(coords).astype(float)
        coords[..., 0] = coords[..., 0] * (new_w / old_w)
        coords[..., 1] = coords[..., 1] * (new_h / old_h)
        return coords

    def encode(self, cv_image):
        original_size = cv_image.shape[:2]
        scale_x = self.input_size[1] / cv_image.shape[1]
        scale_y = self.input_size[0] / cv_image.shape[0]
        scale = min(scale_x, scale_y)
        transform_matrix = np.array([
            [scale, 0, 0],
            [0, scale, 0],
            [0, 0, 1],
        ])
        cv_image = cv2.warpAffine(
            cv_image, transform_matrix[:2],
            (self.input_size[1], self.input_size[0]),
            flags=cv2.INTER_LINEAR,
        )
        encoder_inputs = {self.encoder_input_name: cv_image.astype(np.float32)}
        image_embedding = self.encoder_session.run(None, encoder_inputs)[0]
        return {
            "image_embedding": image_embedding,
            "original_size": original_size,
            "transform_matrix": transform_matrix,
        }

    def decode(self, embedding, prompts):
        input_points, input_labels = self._get_input_points(prompts)

        onnx_coord = np.concatenate([input_points, np.array([[0.0, 0.0]])], axis=0)[None, :, :]
        onnx_label = np.concatenate([input_labels, np.array([-1])], axis=0)[None, :].astype(np.float32)
        onnx_coord = self.apply_coords(onnx_coord, self.input_size, self.target_size).astype(np.float32)

        transform_matrix = embedding["transform_matrix"]
        onnx_coord = np.concatenate([onnx_coord, np.ones((1, onnx_coord.shape[1], 1), dtype=np.float32)], axis=2)
        onnx_coord = np.matmul(onnx_coord, transform_matrix.T)
        onnx_coord = onnx_coord[:, :, :2].astype(np.float32)

        onnx_mask_input = np.zeros((1, 1, 256, 256), dtype=np.float32)
        onnx_has_mask_input = np.zeros(1, dtype=np.float32)

        decoder_inputs = {
            "image_embeddings": embedding["image_embedding"],
            "point_coords": onnx_coord,
            "point_labels": onnx_label,
            "mask_input": onnx_mask_input,
            "has_mask_input": onnx_has_mask_input,
            "orig_im_size": np.array(self.input_size, dtype=np.float32),
        }
        masks, scores, _ = self.decoder_session.run(None, decoder_inputs)

        # Select the best mask by IoU score
        scores_squeezed = scores.squeeze()
        best_idx = int(np.argmax(scores_squeezed))

        # Transform the best mask back to original size
        inv_transform_matrix = np.linalg.inv(transform_matrix)
        original_size = embedding["original_size"]
        best_mask = masks[0, best_idx]
        best_mask = cv2.warpAffine(
            best_mask, inv_transform_matrix[:2],
            (original_size[1], original_size[0]),
            flags=cv2.INTER_LINEAR,
        )
        return np.array([[best_mask]])

    @staticmethod
    def _get_input_points(prompts):
        points, labels = [], []
        for mark in prompts:
            if mark["type"] == "point":
                points.append(mark["data"])
                labels.append(mark["label"])
            elif mark["type"] == "rectangle":
                points.append([mark["data"][0], mark["data"][1]])
                points.append([mark["data"][2], mark["data"][3]])
                labels.append(2)
                labels.append(3)
        return np.array(points), np.array(labels)


# ---------------------------------------------------------------------------
# SAM2 Model (SegmentAnything2ONNX - from samexporter)
# ---------------------------------------------------------------------------

class SAM2Model:
    """SAM2 encoder/decoder wrapper."""

    def __init__(self, encoder_path, decoder_path, providers):
        self.encoder_session = onnxruntime.InferenceSession(encoder_path, providers=providers)
        encoder_inputs = self.encoder_session.get_inputs()
        self.encoder_input_names = [inp.name for inp in encoder_inputs]
        self.encoder_input_shape = encoder_inputs[0].shape
        self.encoder_input_height = self.encoder_input_shape[2]
        self.encoder_input_width = self.encoder_input_shape[3]
        self.encoder_output_names = [out.name for out in self.encoder_session.get_outputs()]

        self.decoder_session = onnxruntime.InferenceSession(decoder_path, providers=providers)
        self.decoder_input_names = [inp.name for inp in self.decoder_session.get_inputs()]
        self.decoder_output_names = [out.name for out in self.decoder_session.get_outputs()]

        self.encoder_input_size = (self.encoder_input_height, self.encoder_input_width)
        self.scale_factor = 4

    def encode(self, cv_image):
        original_size = cv_image.shape[:2]
        input_img = cv2.cvtColor(cv_image, cv2.COLOR_BGR2RGB)
        input_img = cv2.resize(input_img, (self.encoder_input_width, self.encoder_input_height))

        mean = np.array([0.485, 0.456, 0.406])
        std = np.array([0.229, 0.224, 0.225])
        input_img = (input_img / 255.0 - mean) / std
        input_img = input_img.transpose(2, 0, 1)
        input_tensor = input_img[np.newaxis, :, :, :].astype(np.float32)

        outputs = self.encoder_session.run(
            self.encoder_output_names, {self.encoder_input_names[0]: input_tensor}
        )
        return {
            "high_res_feats_0": outputs[0],
            "high_res_feats_1": outputs[1],
            "image_embedding": outputs[2],
            "original_size": original_size,
        }

    def decode(self, embedding, prompts):
        points, labels = [], []
        for mark in prompts:
            if mark["type"] == "point":
                points.append(mark["data"])
                labels.append(mark["label"])
            elif mark["type"] == "rectangle":
                points.append([mark["data"][0], mark["data"][1]])
                points.append([mark["data"][2], mark["data"][3]])
                labels.append(2)
                labels.append(3)
        points, labels = np.array(points), np.array(labels)

        orig_im_size = embedding["original_size"]

        # Prepare point coordinates (normalize to encoder input size)
        input_point_coords = points[np.newaxis, ...].copy()
        input_point_labels = labels[np.newaxis, ...].copy()

        input_point_coords[..., 0] = input_point_coords[..., 0] / orig_im_size[1] * self.encoder_input_size[1]
        input_point_coords[..., 1] = input_point_coords[..., 1] / orig_im_size[0] * self.encoder_input_size[0]
        input_point_coords = input_point_coords.astype(np.float32)
        input_point_labels = input_point_labels.astype(np.float32)

        num_labels = input_point_labels.shape[0]
        mask_input = np.zeros((
            num_labels, 1,
            self.encoder_input_size[0] // self.scale_factor,
            self.encoder_input_size[1] // self.scale_factor,
        ), dtype=np.float32)
        has_mask_input = np.array([0], dtype=np.float32)

        inputs = (
            embedding["image_embedding"],
            embedding["high_res_feats_0"],
            embedding["high_res_feats_1"],
            input_point_coords,
            input_point_labels,
            mask_input,
            has_mask_input,
        )

        outputs = self.decoder_session.run(
            self.decoder_output_names,
            {self.decoder_input_names[i]: inputs[i] for i in range(len(self.decoder_input_names))},
        )

        scores = outputs[1].squeeze()
        masks = outputs[0][0]
        best_mask = masks[np.argmax(scores)]
        best_mask = cv2.resize(best_mask, (orig_im_size[1], orig_im_size[0]))
        return np.array([[[best_mask]]])


# ---------------------------------------------------------------------------
# Model loader (auto-detect SAM1 vs SAM2)
# ---------------------------------------------------------------------------

def find_model_files(model_dir):
    """Find encoder and decoder ONNX files in model directory."""
    onnx_files = [f for f in os.listdir(model_dir) if f.lower().endswith(".onnx")]
    encoder_path = None
    decoder_path = None

    for f in onnx_files:
        fl = f.lower()
        if "encoder" in fl:
            encoder_path = os.path.join(model_dir, f)
        elif "decoder" in fl:
            decoder_path = os.path.join(model_dir, f)

    if not encoder_path or not decoder_path:
        # Fallback: if exactly 2 onnx files, assume larger is encoder
        if len(onnx_files) == 2:
            paths = [os.path.join(model_dir, f) for f in onnx_files]
            sizes = [os.path.getsize(p) for p in paths]
            if sizes[0] >= sizes[1]:
                encoder_path, decoder_path = paths[0], paths[1]
            else:
                encoder_path, decoder_path = paths[1], paths[0]

    return encoder_path, decoder_path


def load_model(model_dir, device):
    """Load SAM model, auto-detecting SAM1 vs SAM2."""
    encoder_path, decoder_path = find_model_files(model_dir)
    if not encoder_path or not decoder_path:
        print(f"Error: Could not find encoder and decoder ONNX files in {model_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Encoder: {os.path.basename(encoder_path)}")
    print(f"Decoder: {os.path.basename(decoder_path)}")

    # Determine providers
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if device == "gpu" else ["CPUExecutionProvider"]
    # Filter to available providers
    available = onnxruntime.get_available_providers()
    providers = [p for p in providers if p in available]
    if not providers:
        providers = ["CPUExecutionProvider"]
    print(f"Providers: {providers}")

    # Auto-detect model variant by checking encoder output count
    temp_session = onnxruntime.InferenceSession(encoder_path, providers=["CPUExecutionProvider"])
    num_outputs = len(temp_session.get_outputs())
    del temp_session

    if num_outputs >= 3:
        print("Detected model variant: SAM2")
        model = SAM2Model(encoder_path, decoder_path, providers)
    else:
        print("Detected model variant: SAM1")
        model = SAM1Model(encoder_path, decoder_path, providers)

    return model


# ---------------------------------------------------------------------------
# HTTP Request Handler
# ---------------------------------------------------------------------------

class SAMHandler(BaseHTTPRequestHandler):
    model = None
    cached_embedding = None
    cached_image_path = None
    cached_crop = None  # {"x": int, "y": int, "w": int, "h": int} or None

    def log_message(self, format, *args):
        """Override to add timestamp and flush."""
        print(f"[{time.strftime('%H:%M:%S')}] {format % args}", flush=True)

    def _set_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send_json(self, data, status=200):
        self._set_headers(status)
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _read_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length)
        return json.loads(body.decode("utf-8"))

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self._set_headers(204)

    def do_GET(self):
        if self.path == "/ping":
            self._send_json({"ok": True, "status": "running"})
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        try:
            body = self._read_body()

            if self.path == "/encode":
                self._handle_encode(body)
            elif self.path == "/decode":
                self._handle_decode(body)
            else:
                self._send_json({"error": "Not found"}, 404)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr, flush=True)
            import traceback
            traceback.print_exc()
            self._send_json({"error": str(e)}, 500)

    def _handle_encode(self, body):
        image_path = body.get("image_path", "")
        if not image_path or not os.path.exists(image_path):
            self._send_json({"error": f"Image not found: {image_path}"}, 400)
            return

        # Parse optional crop region
        crop = body.get("crop", None)  # {"x": int, "y": int, "w": int, "h": int}

        # Check cache (must match both image path and crop region)
        if (SAMHandler.cached_image_path == image_path
                and SAMHandler.cached_embedding is not None
                and SAMHandler.cached_crop == crop):
            self.log_message("Encoder cache hit: %s%s",
                             os.path.basename(image_path),
                             f" crop={crop}" if crop else "")
            self._send_json({"ok": True, "cached": True})
            return

        # Read image
        t0 = time.perf_counter()
        cv_image = imread_unicode(image_path)
        if cv_image is None:
            self._send_json({"error": f"Failed to read image: {image_path}"}, 400)
            return

        # Apply crop if specified
        if crop:
            x, y, w, h = int(crop["x"]), int(crop["y"]), int(crop["w"]), int(crop["h"])
            img_h, img_w = cv_image.shape[:2]
            # Clamp to image bounds
            x = max(0, min(x, img_w - 1))
            y = max(0, min(y, img_h - 1))
            w = min(w, img_w - x)
            h = min(h, img_h - y)
            if w <= 0 or h <= 0:
                self._send_json({"error": "Invalid crop region"}, 400)
                return
            cv_image = cv_image[y:y + h, x:x + w]

        # Encode
        if SAMHandler.model is None:
            self._send_json({"error": "Model not loaded"}, 500)
            return
        embedding = SAMHandler.model.encode(cv_image)
        t1 = time.perf_counter()

        SAMHandler.cached_embedding = embedding
        SAMHandler.cached_image_path = image_path
        SAMHandler.cached_crop = crop

        crop_info = f" crop=({x},{y},{w},{h})" if crop else ""
        self.log_message("Encoded %s%s in %.0fms",
                         os.path.basename(image_path), crop_info, (t1 - t0) * 1000)
        self._send_json({"ok": True, "cached": False, "time_ms": round((t1 - t0) * 1000)})

    def _handle_decode(self, body):
        prompts = body.get("prompts", [])
        if not prompts:
            self._send_json({"error": "No prompts provided"}, 400)
            return

        if SAMHandler.cached_embedding is None:
            self._send_json({"error": "No image encoded. Call /encode first."}, 400)
            return

        # Decode
        t0 = time.perf_counter()
        if SAMHandler.model is None:
            self._send_json({"error": "Model not loaded"}, 500)
            return
        masks = SAMHandler.model.decode(SAMHandler.cached_embedding, prompts)
        t1 = time.perf_counter()

        # Extract best mask and convert to contour
        # Both SAM1 and SAM2 now return (1, 1, H, W) with the best mask pre-selected
        mask_2d = masks.squeeze()

        # Threshold
        binary_mask = (mask_2d > 0.0).astype(np.uint8) * 255

        # Find contours
        contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            self._send_json({"ok": True, "contour": [], "time_ms": round((t1 - t0) * 1000)})
            return

        # Take the largest contour
        largest = max(contours, key=cv2.contourArea)
        if len(largest) < 3:
            self._send_json({"ok": True, "contour": [], "time_ms": round((t1 - t0) * 1000)})
            return

        contour_points = largest.squeeze().tolist()
        # Ensure it's a list of [x, y] pairs
        if isinstance(contour_points[0], (int, float)):
            contour_points = [contour_points]

        self.log_message("Decoded in %.0fms, contour points: %d", (t1 - t0) * 1000, len(contour_points))
        self._send_json({
            "ok": True,
            "contour": contour_points,
            "time_ms": round((t1 - t0) * 1000),
        })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="SAM Service for LabelEditor")
    parser.add_argument("--model_dir", "-m", required=True, help="Model directory (encoder.onnx + decoder.onnx)")
    parser.add_argument("--device", default="cpu", choices=["cpu", "gpu"])
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    print("=" * 60)
    print("SAM Service for LabelEditor-for-VSCode")
    print("=" * 60)

    # Load model
    model = load_model(args.model_dir, args.device)
    SAMHandler.model = model

    # Start server
    server = HTTPServer(("127.0.0.1", args.port), SAMHandler)
    print("-" * 60)
    print(f"Server listening on http://127.0.0.1:{args.port}")
    print("Endpoints: /ping, /encode, /decode")
    print("Press Ctrl+C to stop.")
    print("-" * 60, flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...", flush=True)
        server.server_close()


if __name__ == "__main__":
    main()
