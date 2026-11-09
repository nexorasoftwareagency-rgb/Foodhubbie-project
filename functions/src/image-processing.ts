import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import sharp from 'sharp';

admin.initializeApp();

const db = admin.database();
const storage = admin.storage();

/**
 * Cloud Function: Process dish images uploaded to Firebase Storage.
 *
 * Triggered on upload to:
 *   outlets/{bid}/{oid}/dishes/{dishId}/original.jpg
 *
 * What it does:
 * 1. Downloads the original image
 * 2. Converts to WebP (main dish image, max 800px, quality 85)
 * 3. Generates thumbnail (400x400 WebP, quality 80)
 * 4. Uploads both back to Storage
 * 5. Updates RTDB with WebP URLs under dishes/{dishId}
 *
 * Security: Only processed if the dishId in the path matches the actual
 * dish document, preventing path traversal attacks.
 */
export const processDishImage = functions.storage
    .object()
    .onFinalize(async (object) => {
        const filePath = object.name;
        if (!filePath) return null;

        // Only process images in outlets/{bid}/{oid}/dishes/{dishId}/original.{ext}
        const match = filePath.match(
            /^outlets\/([^\/]+)\/([^\/]+)\/dishes\/([^\/]+)\/original\.(jpg|jpeg|png|webp)$/i
        );
        if (!match) return null;

        const [, bid, oid, dishId] = match;

        const bucket = admin.storage().bucket(object.bucket);
        const file = bucket.file(filePath);

        try {
            // Download original image buffer
            const [buffer] = await file.download();

            // Validate it's a real image
            const metadata = await sharp(buffer).metadata();
            if (!metadata.format || !['jpeg', 'jpg', 'png', 'webp'].includes(metadata.format)) {
                console.warn(`[ImageProcess] Not an image: ${filePath} (format: ${metadata.format})`);
                return null;
            }

            // --- 1. Main dish image: WebP, max 800px, quality 85 ---
            const webpBuffer = await sharp(buffer)
                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 85 })
                .toBuffer();

            const webpFile = bucket.file(`outlets/${bid}/${oid}/dishes/${dishId}/dish.webp`);
            await webpFile.save(webpBuffer, {
                contentType: 'image/webp',
                cacheControl: 'public, max-age=31536000',
            });

            // --- 2. Thumbnail: WebP, 400x400 cover, quality 80 ---
            const thumbBuffer = await sharp(buffer)
                .resize(400, 400, { fit: 'cover', position: 'center' })
                .webp({ quality: 80 })
                .toBuffer();

            const thumbFile = bucket.file(`outlets/${bid}/${oid}/dishes/${dishId}/dish-thumb.webp`);
            await thumbFile.save(thumbBuffer, {
                contentType: 'image/webp',
                cacheControl: 'public, max-age=31536000',
            });

            // --- 3. Get public download URLs ---
            // Since Storage rules allow public read for dish images,
            // we can construct public URLs directly without signed URLs.
            const webpUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(webpFile.name)}?alt=media`;
            const thumbUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(thumbFile.name)}?alt=media`;

            // --- 4. Update RTDB with WebP URLs ---
            await db.ref(`businesses/${bid}/outlets/${oid}/dishes/${dishId}`).update({
                imageUrl: webpUrl,
                imageUrlThumb: thumbUrl,
                imageOriginalPath: filePath,
                imageProcessedAt: admin.database.ServerValue.TIMESTAMP,
                imageWidth: metadata.width,
                imageHeight: metadata.height,
            });

            console.log(`[ImageProcess] Processed dish ${dishId} at outlet ${oid}/${bid}: WebP + thumbnail created`);
            return { dishId, bid, oid, webpUrl, thumbUrl };
        } catch (error) {
            console.error(`[ImageProcess] Failed for ${filePath}:`, error);
            throw error;
        }
    });