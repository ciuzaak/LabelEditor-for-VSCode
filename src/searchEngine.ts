import { comparePathsNaturally } from './labelMeUtils';

export interface AnnotationRecord {
    relPath: string;
    labels: Map<string, number>;   // class name -> instance count
    descriptions: string[];        // kept for index shape compatibility; unused by matching
}

export type AnnotationIndex = AnnotationRecord[];

// A single user-added condition. name/nameRegex carry one value matched against
// the filename; class carries a set of class names that are OR'd among themselves.
export type SearchCondition =
    | { type: 'name'; value: string }
    | { type: 'nameRegex'; value: string }
    | { type: 'class'; values: string[] };

// Conditions are AND'd together. (No global ALL/ANY toggle — see spec revision.)
export interface SearchQuery {
    conditions: SearchCondition[];
}

function basename(relPath: string): string {
    const parts = relPath.split(/[\\/]/);
    return parts[parts.length - 1] || relPath;
}

// A name condition matches when its value appears in the basename, or as a
// fallback anywhere in the relative path (both case-insensitive).
function nameMatches(relPath: string, rawValue: string): boolean {
    const nameQ = rawValue.trim().toLowerCase();
    if (!nameQ) return false;
    if (basename(relPath).toLowerCase().includes(nameQ)) return true;
    return relPath.toLowerCase().includes(nameQ);
}

// A class condition matches when the record carries at least one of the given
// classes (the values inside one condition are OR'd).
function classMatches(record: AnnotationRecord, values: string[]): boolean {
    for (const c of values) {
        const count = record.labels.get(c);
        if (count && count > 0) return true;
    }
    return false;
}

// Drop conditions with no usable value (empty name/regex, empty class set).
function activeConditions(conditions: SearchCondition[]): SearchCondition[] {
    return (conditions || []).filter(c => {
        if (c.type === 'class') return Array.isArray(c.values) && c.values.length > 0;
        return typeof c.value === 'string' && c.value.trim() !== '';
    });
}

// Compiled form of an active condition. A nameRegex with an invalid pattern
// gets regex:null, which makes it match nothing (so the AND yields no results).
interface Compiled {
    cond: SearchCondition;
    regex?: RegExp | null;
}

// Returns the matching relative paths in the gallery's original (natural path)
// order. Conditions are AND'd; query/filter only narrows the list — it never
// reorders it, so results line up with the untouched image browser order.
export function runAdvancedSearch(index: AnnotationIndex, query: SearchQuery): string[] {
    const active = activeConditions(query.conditions || []);
    if (active.length === 0) return [];

    const compiled: Compiled[] = active.map(cond => {
        if (cond.type === 'nameRegex') {
            try {
                return { cond, regex: new RegExp(cond.value.trim(), 'i') };
            } catch {
                return { cond, regex: null };
            }
        }
        return { cond };
    });

    const out: string[] = [];
    for (const record of index) {
        const ok = compiled.every(({ cond, regex }) => {
            if (cond.type === 'name') return nameMatches(record.relPath, cond.value);
            if (cond.type === 'nameRegex') return !!regex && regex.test(basename(record.relPath));
            return classMatches(record, cond.values);
        });
        if (ok) out.push(record.relPath);
    }

    out.sort(comparePathsNaturally);
    return out;
}
