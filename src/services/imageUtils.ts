/**
 * Image processing utilities: validation, canvas downscaling (max 2000px), and base64 conversion.
 */

export interface ProcessedImage {
  mime: string;
  base64: string;
}

const ACCEPTED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function processImageFile(file: File): Promise<ProcessedImage> {
  if (!ACCEPTED_MIMES.has(file.type)) {
    throw new Error('Unsupported image type. Only PNG, JPEG, WebP, and GIF are accepted.');
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image exceeds 5 MB. Please select a smaller image.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.onload = () => {
        const MAX_DIM = 2000;
        let { width, height } = img;

        if (width <= MAX_DIM && height <= MAX_DIM && file.type === 'image/gif') {
          // Keep animated gif as is if within dimensions
          const b64 = (reader.result as string).split(',')[1];
          return resolve({ mime: file.type, base64: b64 });
        }

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const b64 = (reader.result as string).split(',')[1];
          return resolve({ mime: file.type, base64: b64 });
        }

        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/gif' ? 'image/png' : file.type;
        const dataUrl = canvas.toDataURL(mime, 0.9);
        const b64 = dataUrl.split(',')[1];
        resolve({ mime, base64: b64 });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
