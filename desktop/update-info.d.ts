export interface UpdateFile {
  url: string;
  sha512: string;
  size: number;
}
export interface UpdateInfo {
  version: string;
  files: UpdateFile[];
}
export function isNewer(candidate: string, current: string): boolean;
export function parseUpdateInfo(text: string): UpdateInfo | null;
export function pickMacZip(info: UpdateInfo, arch: string): UpdateFile | null;
export function canReplaceAt(bundlePath: string, folderWritable: boolean): boolean;
