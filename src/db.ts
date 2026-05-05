import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CandidateStatus, Focus } from "./types";
import { ensureDir } from "./utils";

export interface AuditRecord {
  repo: string;
  target: string;
  commit: string;
  focus: Focus;
  outputDir: string;
  candidateCount: number;
  submitCount: number;
}

export interface FindingRecord {
  auditId: number;
  title: string;
  status: CandidateStatus;
  severity: string;
  score: number;
}

export function historyPath(): string {
  return join(homedir(), ".tib", "history.db");
}

export async function recordAudit(record: AuditRecord, findings: FindingRecord[]): Promise<void> {
  const path = historyPath();
  await ensureDir(dirname(path));
  const db = new Database(path);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        repo TEXT NOT NULL,
        target TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        focus TEXT NOT NULL,
        output_dir TEXT NOT NULL,
        candidate_count INTEGER NOT NULL,
        submit_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT NOT NULL,
        score REAL NOT NULL,
        FOREIGN KEY (audit_id) REFERENCES audits(id)
      );
    `);

    const result = db
      .query(
        `INSERT INTO audits
          (repo, target, commit_sha, focus, output_dir, candidate_count, submit_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.repo,
        record.target,
        record.commit,
        record.focus,
        record.outputDir,
        record.candidateCount,
        record.submitCount
      );
    const auditId = Number(result.lastInsertRowid);

    const insertFinding = db.query(
      `INSERT INTO findings (audit_id, title, status, severity, score)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const finding of findings) {
      insertFinding.run(auditId, finding.title, finding.status, finding.severity, finding.score);
    }
  } finally {
    db.close();
  }
}
