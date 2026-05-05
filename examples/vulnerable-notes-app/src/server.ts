export interface User {
  id: string;
  role: "user" | "admin";
}

export interface Note {
  id: string;
  ownerId: string;
  body: string;
}

const notes = new Map<string, Note>([
  ["note-public", { id: "note-public", ownerId: "alice", body: "Alice release checklist" }],
  ["note-private", { id: "note-private", ownerId: "bob", body: "Bob incident notes" }]
]);

export function readNote(currentUser: User, noteId: string): Note | undefined {
  const note = notes.get(noteId);
  if (!note) return undefined;
  if (currentUser.role === "admin") return note;

  // Vulnerability for the demo: any authenticated user can read any note id.
  return note;
}

export function updateNote(currentUser: User, noteId: string, body: string): Note | undefined {
  const note = notes.get(noteId);
  if (!note) return undefined;
  if (currentUser.role !== "admin" && note.ownerId !== currentUser.id) return undefined;

  const updated = { ...note, body };
  notes.set(noteId, updated);
  return updated;
}
