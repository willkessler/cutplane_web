import type { CutObject } from '@cutplane/kernel';

/**
 * A parsed .cut / .rsc / .icon file. The format (storage_cutplane.c) holds
 * either a whole world or a branch (a subtree saved on its own, as tools and
 * icons are), as a preorder list of objects.
 */
export interface CutDocument {
  /** The name in the "** Start of file … **" line. */
  title: string;
  contains: 'World' | 'Branch';
  /** World Name, or the branch's name; null when the file says <none>. */
  name: string | null;
  /** Branch Preferred Motherworld, as written ("(none)", "Environment_world", …). */
  preferredMotherworld?: string;
  /** The world-level "Zoom Scale" line some 1991 files carry. */
  zoomScale?: number;
  roots: CutObject[];
}

export interface ReadResult {
  doc: CutDocument;
  /** Recoverable problems: count mismatches, missing end marker, bad references. */
  warnings: string[];
}

export class CutParseError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}
