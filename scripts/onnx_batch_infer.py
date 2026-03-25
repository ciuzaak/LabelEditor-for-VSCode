#!/usr/bin/env python3
"""
ONNX Batch Inference Script for LabelEditor-for-VSCode
Runs ONNX segmentation model on a list of images and outputs LabelMe JSON annotations.
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np
import onnxruntime as ort
from tqdm import tqdm


def imread_unicode(img_path, flags=cv2.IMREAD_COLOR):
    """Read image supporting unicode/Chinese file paths."""
    data = np.fromfile(img_path, dtype=np.uint8)
    return cv2.imdecode(data, flags)


def mask_to_shapes(mask, value2label):
    """Convert segmentation mask to LabelMe polygon shapes."""
    shapes = []
    for value, label_name in value2label.items():
        class_mask = (mask == value).astype(np.uint8) * 255
        contours, _ = cv2.findContours(class_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if len(contour) < 3:
                continue
            points = contour.squeeze().tolist()
            if isinstance(points[0], int):
                continue
            # Align mask-derived polygon points with pixel centers in display space
            points = [[p[0] + 0.5, p[1] + 0.5] for p in points]
            shapes.append({
                "label": label_name,
                "points": points,
                "group_id": None,
                "description": "",
                "shape_type": "polygon",
                "flags": {},
                "mask": None,
            })
    return shapes


def load_model(model_dir, device):
    """Load ONNX model and labels from model directory."""
    # Find .onnx file
    onnx_files = [f for f in os.listdir(model_dir) if f.endswith(".onnx")]
    if not onnx_files:
        print(f"Error: No .onnx file found in {model_dir}", file=sys.stderr)
        sys.exit(1)
    model_path = os.path.join(model_dir, onnx_files[0])

    # Load labels
    labels_path = os.path.join(model_dir, "labels.json")
    if not os.path.exists(labels_path):
        print(f"Error: labels.json not found in {model_dir}", file=sys.stderr)
        sys.exit(1)

    with open(labels_path, encoding="utf-8") as f:
        label_info = json.load(f)
    value2label = {item["value"]: item["name"] for item in label_info}

    # Create session
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"] if device == "gpu" else ["CPUExecutionProvider"]
    try:
        session = ort.InferenceSession(model_path, providers=providers)
    except Exception as e:
        print(f"Error loading model: {e}", file=sys.stderr)
        sys.exit(1)

    actual_provider = session.get_providers()[0]
    print(f"Model: {os.path.basename(model_path)}")
    print(f"Provider: {actual_provider}")

    input_info = session.get_inputs()[0]
    output_name = session.get_outputs()[0].name
    input_shape = input_info.shape  # e.g. [1, 3, 512, 512] or ['N', 3, 'H', 'W']

    # Detect dynamic dimensions (strings like 'N', 'H', 'W' instead of ints)
    is_dynamic = any(not isinstance(d, int) for d in input_shape)
    input_channels = input_shape[1] if isinstance(input_shape[1], int) else 3
    is_grayscale = input_channels == 1

    mode_str = 'dynamic' if is_dynamic else 'static'
    color_str = 'grayscale' if is_grayscale else 'color'
    print(f"Input: {input_info.name} {input_shape} ({mode_str}, {color_str})")

    return session, input_info.name, output_name, input_shape, is_dynamic, is_grayscale, value2label


def _need_resize(input_shape, is_dynamic, h, w):
    """Check if image needs resizing to match model input."""
    if is_dynamic:
        return False
    model_h, model_w = input_shape[2], input_shape[3]
    return h != model_h or w != model_w


def infer_image(session, input_name, output_name, input_shape, is_dynamic, is_grayscale, img_path, color_format):
    """Run inference on a single image, return (mask, height, width) or None on error."""
    try:
        if is_grayscale:
            img = imread_unicode(img_path, cv2.IMREAD_GRAYSCALE)
            if img is None:
                print(f"  Warning: Cannot read {img_path}", file=sys.stderr)
                return None
            h, w = img.shape
            need_resize = _need_resize(input_shape, is_dynamic, h, w)
            img_proc = cv2.resize(img, (input_shape[3], input_shape[2])) if need_resize else img
            img_input = np.expand_dims(np.expand_dims(img_proc, 0), 0).astype(np.uint8)
        else:
            img = imread_unicode(img_path, cv2.IMREAD_COLOR)
            if img is None:
                print(f"  Warning: Cannot read {img_path}", file=sys.stderr)
                return None
            if color_format == "rgb":
                img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            h, w = img.shape[:2]
            need_resize = _need_resize(input_shape, is_dynamic, h, w)
            img_proc = cv2.resize(img, (input_shape[3], input_shape[2])) if need_resize else img
            img_input = np.expand_dims(np.transpose(img_proc, (2, 0, 1)), 0).astype(np.uint8)

        output = session.run([output_name], {input_name: img_input})[0][0].astype(np.uint8)
        # Only resize output back if we resized the input
        if need_resize:
            output = cv2.resize(output, (w, h), interpolation=cv2.INTER_NEAREST)
        return output, h, w
    except Exception as e:
        print(f"  Warning: Inference failed for {img_path}: {e}", file=sys.stderr)
        return None


def main():
    parser = argparse.ArgumentParser(description="ONNX batch inference for LabelEditor")
    parser.add_argument("--model_dir", "-m", required=True, help="Model directory (.onnx + labels.json)")
    parser.add_argument("--images_json", "-i", required=True, help="JSON file containing list of image paths")
    parser.add_argument("--mode", default="skip", choices=["skip", "merge", "overwrite"],
                        help="How to handle images with existing annotations")
    parser.add_argument("--device", default="cpu", choices=["cpu", "gpu"])
    parser.add_argument("--color_format", default="rgb", choices=["rgb", "bgr"])
    args = parser.parse_args()

    # Load image list
    with open(args.images_json, encoding="utf-8") as f:
        image_paths = json.load(f)

    if not image_paths:
        print("No images to process.")
        return

    print(f"Images: {len(image_paths)}")
    print(f"Mode: {args.mode} | Device: {args.device} | Color: {args.color_format}")
    print("-" * 60)

    # Load model
    session, input_name, output_name, input_shape, is_dynamic, is_grayscale, value2label = load_model(args.model_dir, args.device)
    print("-" * 60)

    skipped = 0
    processed = 0
    errors = 0

    for img_path in tqdm(image_paths, desc="Inferring", unit="img"):
        json_path = os.path.splitext(img_path)[0] + ".json"
        has_existing = os.path.exists(json_path)

        # Handle existing annotations
        if has_existing and args.mode == "skip":
            skipped += 1
            continue

        result = infer_image(session, input_name, output_name, input_shape, is_dynamic, is_grayscale, img_path, args.color_format)
        if result is None:
            errors += 1
            continue

        mask, h, w = result
        new_shapes = mask_to_shapes(mask, value2label)

        if has_existing and args.mode == "merge":
            # Load existing and append new shapes
            try:
                with open(json_path, encoding="utf-8") as f:
                    existing_data = json.load(f)
                existing_shapes = existing_data.get("shapes", [])
                all_shapes = existing_shapes + new_shapes
            except Exception as e:
                print(f"  Warning: Cannot read existing {json_path}: {e}, skipping.", file=sys.stderr)
                errors += 1
                continue
        else:
            all_shapes = new_shapes

        labelme_data = {
            "version": "5.0.1",
            "flags": {},
            "shapes": all_shapes,
            "imagePath": os.path.basename(img_path),
            "imageData": None,
            "imageHeight": h,
            "imageWidth": w,
        }

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(labelme_data, f, ensure_ascii=False, indent=2)

        processed += 1

    print("-" * 60)
    print(f"Done! Processed: {processed}, Skipped: {skipped}, Errors: {errors}")
    if processed > 0:
        print("Tip: Switch to another image and back (or reopen) in LabelEditor to see new annotations.")


if __name__ == "__main__":
    main()
