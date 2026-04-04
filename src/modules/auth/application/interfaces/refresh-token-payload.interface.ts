export interface IRefreshTokenPayload {
  sub: string;
  sid: string;
  fid: string;
  rm: boolean;
  sa?: string | null;
}
