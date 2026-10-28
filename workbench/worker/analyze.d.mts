export const ANALYZER_VERSION: string;
export const LIMITS: Record<string, number>;
export class XmlError extends Error {}
export function readZip(buf: Buffer, limits?: Record<string, number>): { entries?: { name: string; encrypted: boolean; usize: number; csize: number; method: number }[]; error?: string; limit?: string };
export function walkXml(src: string, handlers: { start?: (name: string, attrs: [string, string][], self: boolean) => void; end?: (name: string) => void; text?: (t: string) => void }, limits?: Record<string, number>): void;
export function decodeEntities(s: string): string;
export function profileSelector(raw: string): { root: string; elements: number; apps: string[]; idx: boolean; wildcards: number; stable: boolean; dynamicId: boolean; dynamic: boolean; fragile: boolean; fp: string };
export function analyzeXaml(text: string, file: string, limits?: Record<string, number>): any;
export function analyzePackage(bytes: Uint8Array | Buffer, opts?: object, limits?: Record<string, number>): any;
