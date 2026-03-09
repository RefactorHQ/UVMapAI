export type SamPointPrompt = {
  x: number;
  y: number;
  label: 0 | 1;
  objectId?: number;
};

export type SamSegmentRequest = {
  imageBase64: string;
  points: SamPointPrompt[];
  prompt?: string;
  maxMasks?: number;
};

export type SamSegmentResponse = {
  maskBase64List: string[];
};
