import { comparePathsNaturally } from './labelMeUtils';

export interface AnnotationRecord {
    relPath: string;
    labels: Map<string, number>;   // class name -> instance count
    descriptions: string[];        // non-empty shape descriptions
}

export type AnnotationIndex = AnnotationRecord[];

// A single user-added condition. name/description carry one substring value;
// class carries a set of class names that are OR'd among themselves.
export type SearchCondition =
    | { type: 'name'; value: string }
    | { type: 'description'; value: string }
    | { type: 'class'; values: string[] };

// Conditions are AND'd together. (No global ALL/ANY toggle — see spec revision.)
export interface SearchQuery {
    conditions: SearchCondition[];
}

export interface SearchResult {
    relPath: string;
    score: number;
    nameMatchKind: 'exact' | 'prefix' | 'substr' | 'none'; // best across name conditions
    matchedClasses: string[];     // union across class conditions
    classInstanceCount: number;
    descMatchCount: number;
}

const WEIGHTS = {
    nameExact: 1000,
    namePrefix: 500,
    nameSubstr: 200,
    classPresent: 100,
    classInstance: 10,
    descHit: 50,
    descPrefixBonus: 20,
};

const NAME_KIND_RANK: Record<SearchResult['nameMatchKind'], number> = {
    none: 0, substr: 1, prefix: 2, exact: 3,
};

function basename(relPath: string): string {
    const parts = relPath.split(/[\\/]/);
    return parts[parts.length - 1] || relPath;
}

function nameScore(relPath: string, rawValue: string): { kind: SearchResult['nameMatchKind']; contribution: number } {
    const nameQ = rawValue.trim().toLowerCase();
    if (!nameQ) return { kind: 'none', contribution: 0 };
    const base = basename(relPath).toLowerCase();
    const stem = base.replace(/\.[^.]+$/, ''); // filename without extension
    if (stem === nameQ || base === nameQ) return { kind: 'exact', contribution: WEIGHTS.nameExact };
    if (base.startsWith(nameQ)) return { kind: 'prefix', contribution: WEIGHTS.namePrefix };
    if (base.includes(nameQ)) return { kind: 'substr', contribution: WEIGHTS.nameSubstr };
    if (relPath.toLowerCase().includes(nameQ)) return { kind: 'substr', contribution: WEIGHTS.nameSubstr };
    return { kind: 'none', contribution: 0 };
}

function classScore(record: AnnotationRecord, values: string[]): { satisfied: boolean; matched: string[]; instanceCount: number; contribution: number } {
    const matched: string[] = [];
    let instanceCount = 0;
    for (const c of values) {
        const count = record.labels.get(c);
        if (count && count > 0) { matched.push(c); instanceCount += count; }
    }
    return {
        satisfied: matched.length > 0,
        matched,
        instanceCount,
        contribution: matched.length * WEIGHTS.classPresent + instanceCount * WEIGHTS.classInstance,
    };
}

function descScore(record: AnnotationRecord, rawValue: string): { satisfied: boolean; count: number; contribution: number } {
    const descQ = rawValue.trim().toLowerCase();
    if (!descQ) return { satisfied: false, count: 0, contribution: 0 };
    let count = 0;
    let prefixCount = 0;
    for (const d of record.descriptions) {
        const dl = d.toLowerCase();
        if (dl.includes(descQ)) {
            count++;
            if (dl === descQ || dl.startsWith(descQ)) prefixCount++;
        }
    }
    return {
        satisfied: count > 0,
        count,
        contribution: count * WEIGHTS.descHit + prefixCount * WEIGHTS.descPrefixBonus,
    };
}

// Drop conditions with no usable value (empty name/description, empty class set).
function activeConditions(conditions: SearchCondition[]): SearchCondition[] {
    return (conditions || []).filter(c => {
        if (c.type === 'class') return Array.isArray(c.values) && c.values.length > 0;
        return typeof c.value === 'string' && c.value.trim() !== '';
    });
}

export function runAdvancedSearch(index: AnnotationIndex, query: SearchQuery): SearchResult[] {
    const active = activeConditions(query.conditions || []);
    if (active.length === 0) return [];

    const out: SearchResult[] = [];
    for (const record of index) {
        let ok = true;
        let score = 0;
        let bestName: SearchResult['nameMatchKind'] = 'none';
        const matchedClasses = new Set<string>();
        let classInstanceCount = 0;
        let descMatchCount = 0;

        for (const cond of active) {
            if (cond.type === 'name') {
                const r = nameScore(record.relPath, cond.value);
                if (r.kind === 'none') { ok = false; break; }
                score += r.contribution;
                if (NAME_KIND_RANK[r.kind] > NAME_KIND_RANK[bestName]) bestName = r.kind;
            } else if (cond.type === 'class') {
                const r = classScore(record, cond.values);
                if (!r.satisfied) { ok = false; break; }
                score += r.contribution;
                r.matched.forEach(c => matchedClasses.add(c));
                classInstanceCount += r.instanceCount;
            } else {
                const r = descScore(record, cond.value);
                if (!r.satisfied) { ok = false; break; }
                score += r.contribution;
                descMatchCount += r.count;
            }
        }
        if (!ok) continue;

        out.push({
            relPath: record.relPath,
            score,
            nameMatchKind: bestName,
            matchedClasses: Array.from(matchedClasses),
            classInstanceCount,
            descMatchCount,
        });
    }

    out.sort((a, b) => (b.score - a.score) || comparePathsNaturally(a.relPath, b.relPath));
    return out;
}
