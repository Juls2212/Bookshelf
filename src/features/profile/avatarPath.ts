/** Remote object path of a user's profile photo (avatars bucket). One photo per user. */
export function avatarPathFor(userId: string): string {
  return `${userId}/avatar.jpg`;
}
