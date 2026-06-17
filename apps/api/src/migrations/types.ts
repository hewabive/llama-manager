export interface Migration {
  id: string;
  describe: string;
  isApplied: () => boolean;
  apply: () => void;
}
