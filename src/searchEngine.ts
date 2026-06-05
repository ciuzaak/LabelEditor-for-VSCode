import { comparePathsNaturally } from './labelMeUtils';

export interface AnnotationRecord {
    relPath: string;
    labels: Map<string, number>;   // class name -> instance count
    descriptions: string[];        // non-empty shape descriptions
}

export type AnnotationIndex = AnnotationRecord[];

export interface SearchQuery {
    combinator: 'all' | 'any';
    name: string;          // image-name substring, '' = inactive
    classes: string[];     // selected class names, [] = inactive
    description: string;   // description substring, '' = inactive
}

export interface SearchResult {
    relPath: string;
    score: number;
    nameMatchKind: 'exact' | 'prefix' | 'substr' | 'none';
    matchedClasses: string[];
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

function basename(relPath: string): string {
    const parts = relPath.split(/[\\/]/);
    return parts[parts.length - 1] || relPath;
}

interface Scored {
    result: SearchResult;
    nameContribution: number;
    classContribution: number;
    descContribution: number;
    nameSatisfied: boolean;
    classSatisfied: boolean;
    descSatisfied: boolean;
}

function evaluate(record: AnnotationRecord, query: SearchQuery): Scored {
    // Name
    const nameQ = query.name.trim().toLowerCase();
    let nameMatchKind: SearchResult['nameMatchKind'] = 'none';
    let nameContribution = 0;
    if (nameQ) {
        const base = basename(record.relPath).toLowerCase();
        const stem = base.replace(/\.[^.]+$/, ''); // filename without extension
        if (stem === nameQ || base === nameQ) { nameMatchKind = 'exact'; nameContribution = WEIGHTS.nameExact; }
        else if (base.startsWith(nameQ)) { nameMatchKind = 'prefix'; nameContribution = WEIGHTS.namePrefix; }
        else if (base.includes(nameQ)) { nameMatchKind = 'substr'; nameContribution = WEIGHTS.nameSubstr; }
        else if (record.relPath.toLowerCase().includes(nameQ)) { nameMatchKind = 'substr'; nameContribution = WEIGHTS.nameSubstr; }
    }

    // Classes (multi-select OR)
    const matchedClasses: string[] = [];
    let classInstanceCount = 0;
    for (const c of query.classes) {
        const count = record.labels.get(c);
        if (count && count > 0) { matchedClasses.push(c); classInstanceCount += count; }
    }
    const classContribution = matchedClasses.length * WEIGHTS.classPresent + classInstanceCount * WEIGHTS.classInstance;

    // Description (substring)
    const descQ = query.description.trim().toLowerCase();
    let descMatchCount = 0;
    let descPrefixCount = 0;
    if (descQ) {
        for (const d of record.descriptions) {
            const dl = d.toLowerCase();
            if (dl.includes(descQ)) {
                descMatchCount++;
                if (dl === descQ || dl.startsWith(descQ)) descPrefixCount++;
            }
        }
    }
    const descContribution = descMatchCount * WEIGHTS.descHit + descPrefixCount * WEIGHTS.descPrefixBonus;

    return {
        result: {
            relPath: record.relPath,
            score: 0,
            nameMatchKind,
            matchedClasses,
            classInstanceCount,
            descMatchCount,
        },
        nameContribution,
        classContribution,
        descContribution,
        nameSatisfied: nameMatchKind !== 'none',
        classSatisfied: matchedClasses.length > 0,
        descSatisfied: descMatchCount > 0,
    };
}

export function runAdvancedSearch(index: AnnotationIndex, query: SearchQuery): SearchResult[] {
    const nameActive = query.name.trim() !== '';
    const classActive = query.classes.length > 0;
    const descActive = query.description.trim() !== '';
    if (!nameActive && !classActive && !descActive) return [];

    const out: SearchResult[] = [];
    for (const record of index) {
        const s = evaluate(record, query);

        const satisfiedFlags: boolean[] = [];
        if (nameActive) satisfiedFlags.push(s.nameSatisfied);
        if (classActive) satisfiedFlags.push(s.classSatisfied);
        if (descActive) satisfiedFlags.push(s.descSatisfied);

        const qualifies = query.combinator === 'all'
            ? satisfiedFlags.every(Boolean)
            : satisfiedFlags.some(Boolean);
        if (!qualifies) continue;

        // Score = sum of contributions from satisfied active criteria.
        let score = 0;
        if (nameActive && s.nameSatisfied) score += s.nameContribution;
        if (classActive && s.classSatisfied) score += s.classContribution;
        if (descActive && s.descSatisfied) score += s.descContribution;

        out.push({ ...s.result, score });
    }

    out.sort((a, b) => (b.score - a.score) || comparePathsNaturally(a.relPath, b.relPath));
    return out;
}
