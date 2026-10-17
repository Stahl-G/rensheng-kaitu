import { z } from "zod";

export const canon = z.enum(["confirmed", "tentative", "ai_inference", "excerpt"]);
export const anchorSchema = z.object({
  documentId: z.string(),
  path: z.string(),
  heading: z.string(),
  quote: z.string().min(1),
  fileHash: z.string(),
  quoteHash: z.string(),
  line: z.number().int().positive(),
});
export type Anchor = z.infer<typeof anchorSchema>;
export const factSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  kind: z.enum(["person", "place"]),
  text: z.string().min(1),
  canon: canon,
  sources: z.array(anchorSchema).min(1),
  confirmedAt: z.string().optional(),
});
export type Fact = z.infer<typeof factSchema>;
export interface Scene {
  id: string;
  documentId: string;
  title: string;
  path: string;
  heading: string;
  line: number;
  fileHash: string;
  words: number;
  characters: number;
  writtenAt: string;
  order: number;
  status: "planned" | "draft" | "done";
  worldTime: string | null;
}
export interface Document {
  id: string;
  path: string;
  hash: string;
  identity: string;
  modified: string;
}
export interface Proposal {
  id: string;
  baseCanon: string;
  before: Fact | null;
  after: Fact;
  state: "pending" | "approved" | "rejected" | "undone";
  created: string;
  actor: "author" | "agent";
  approvedAt?: string;
}
export interface NovelData {
  schemaVersion: 1;
  project: string;
  sourceRoot: string;
  managedRoot: string;
  mode: "files" | "headings";
  include: string[];
  exclude: string[];
  pinned: boolean;
  documents: Document[];
  scenes: Scene[];
  issues: string[];
  indexedAt: string | null;
  writingMode?: "read_only" | "writing";
  drafts?: {
    id: string;
    title: string;
    text: string;
    scene: string;
    sourceHash: string;
    styleSources: string[];
    created: string;
    applied?: { path: string; before: string; afterHash: string };
  }[];
  facts: Fact[];
  proposals: Proposal[];
  sessions: { id: string; scene: string; completed: string; next: string; savedAt: string }[];
}
export interface NovelView {
  revision: string;
  data: NovelData;
  staleFacts: string[];
  staleProposals: string[];
}
