import { segmentWithHttpSamService } from "./providers/httpSamService";
import type { SamSegmentRequest, SamSegmentResponse } from "./types";

export async function segmentWithSam(
  request: SamSegmentRequest
): Promise<SamSegmentResponse> {
  return segmentWithHttpSamService(request);
}
