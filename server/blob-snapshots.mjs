import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { snapshotPath } from './snapshot-runtime.mjs';

export const blobSnapshots = {
  async read() {
    const result = await get(snapshotPath, { access: 'private', useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw new Error('SnapshotReadFailed');
    const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
    return { bytes, etag: result.blob.etag };
  },
  async write(bytes, etag) {
    try {
      await put(snapshotPath, bytes, {
        access: 'private',
        contentType: 'application/vnd.sqlite3',
        addRandomSuffix: false,
        allowOverwrite: true,
        ifMatch: etag
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      throw error;
    }
  }
};
