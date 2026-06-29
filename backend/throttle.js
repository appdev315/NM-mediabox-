import { Transform } from 'stream';

export class ThrottleStream extends Transform {
    constructor(bytesPerSecond) {
        super();
        this.bytesPerSecond = bytesPerSecond;
        this.passedBytes = 0;
        this.startTime = Date.now();
    }

    _transform(chunk, encoding, callback) {
        this.passedBytes += chunk.length;
        const now = Date.now();
        const elapsedSeconds = (now - this.startTime) / 1000;
        const expectedBytes = elapsedSeconds * this.bytesPerSecond;

        if (this.passedBytes > expectedBytes) {
            const delayMs = ((this.passedBytes - expectedBytes) / this.bytesPerSecond) * 1000;
            // Cap the delay to avoid excessive timeouts in case of bursts
            setTimeout(() => callback(null, chunk), Math.min(delayMs, 5000));
        } else {
            callback(null, chunk);
        }
    }
}
