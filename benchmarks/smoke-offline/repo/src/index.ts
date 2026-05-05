export function canDeleteProject(user: { id: string; role: string }, project: { ownerId: string }): boolean {
  if (user.role === "admin") return true;
  return user.id === project.ownerId;
}
