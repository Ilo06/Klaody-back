import exifr from 'exifr';
import sharp from 'sharp';

// Photo details (EXIF / GPS) for GET /files/:id/details.
// Read straight from the file on disk each time (cheap: exifr only reads the header), nothing is stored in the DB.

export interface ImageDetails {
  width: number | null;
  height: number | null;
  format: string | null;
  exif: {
    cameraMake: string | null;
    cameraModel: string | null;
    lens: string | null;
    takenAt: string | null; // camera wall-clock time, "YYYY-MM-DDTHH:MM:SS" with no timezone (EXIF has none): show it as-is
    iso: number | null;
    fNumber: number | null; // 1.8 -> f/1.8
    exposureTime: number | null; // seconds, 0.004 -> 1/250 s
    focalLength: number | null; // mm
    focalLength35mm: number | null; // mm, 35mm-equivalent
    exposureBias: number | null; // EV
    flash: string | null;
    meteringMode: string | null;
    whiteBalance: string | null;
    software: string | null;
  } | null; // null = the file carries no EXIF at all (screenshots, most PNG/WebP...)
  gps: { latitude: number; longitude: number; altitude: number | null } | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

// EXIF dates are "YYYY:MM:DD HH:MM:SS" with no timezone. Returned as a naive "YYYY-MM-DDTHH:MM:SS" (no Z)
// so the result never depends on the server's timezone; clients must show it as-is, not convert it.
function takenAt(v: unknown): string | null {
  const m = typeof v === 'string' ? /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v) : null;
  return m && m[1] !== '0000' ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

// GPSAltitudeRef 1 (or its translated text) = below sea level.
function altitude(raw: Record<string, unknown>): number | null {
  const value = num(raw.GPSAltitude);
  if (value === null) return null;
  const ref = raw.GPSAltitudeRef;
  const below = ref === 1 || (typeof ref === 'string' && /below/i.test(ref));
  return below ? -Math.abs(value) : value;
}

export async function readImageDetails(filePath: string): Promise<ImageDetails> {
  let width: number | null = null;
  let height: number | null = null;
  let format: string | null = null;
  try {
    const meta = await sharp(filePath, { failOn: 'none' }).metadata();
    // Orientations 5-8 mean the image is stored rotated by 90°: swap so the numbers match what the user sees.
    const rotated = (meta.orientation ?? 1) >= 5;
    width = (rotated ? meta.height : meta.width) ?? null;
    height = (rotated ? meta.width : meta.height) ?? null;
    format = meta.format ?? null;
  } catch {
    // Undecodable by sharp (e.g. HEIC on a prebuilt libvips): still try EXIF below.
  }

  let raw: Record<string, unknown> | undefined;
  try {
    raw = await exifr.parse(filePath, {
      tiff: true,
      exif: true,
      gps: true,
      ifd0: true,
      ifd1: false,
      xmp: false,
      icc: false,
      iptc: false,
      translateValues: true, // "Flash fired" instead of 1
      reviveValues: false, // keep dates as raw strings: Date objects would be built in the server's timezone
      mergeOutput: true,
    });
  } catch {
    raw = undefined; // corrupt / unsupported EXIF block: report "no EXIF" rather than failing the request
  }

  if (!raw) return { width, height, format, exif: null, gps: null };

  const lat = num(raw.latitude);
  const lon = num(raw.longitude);

  const exif = {
    cameraMake: str(raw.Make),
    cameraModel: str(raw.Model),
    lens: str(raw.LensModel),
    takenAt: takenAt(raw.DateTimeOriginal) ?? takenAt(raw.CreateDate),
    iso: num(raw.ISO),
    fNumber: num(raw.FNumber),
    exposureTime: num(raw.ExposureTime),
    focalLength: num(raw.FocalLength),
    focalLength35mm: num(raw.FocalLengthIn35mmFormat),
    exposureBias: num(raw.ExposureBiasValue),
    flash: str(raw.Flash),
    meteringMode: str(raw.MeteringMode),
    whiteBalance: str(raw.WhiteBalance),
    software: str(raw.Software),
  };
  const hasExif = Object.values(exif).some((v) => v !== null);

  return {
    width: width ?? num(raw.ExifImageWidth) ?? num(raw.ImageWidth),
    height: height ?? num(raw.ExifImageHeight) ?? num(raw.ImageHeight),
    format,
    exif: hasExif ? exif : null,
    gps: lat !== null && lon !== null ? { latitude: lat, longitude: lon, altitude: altitude(raw) } : null,
  };
}
