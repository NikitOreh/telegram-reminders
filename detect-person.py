"""Classify an image locally with OpenCV Zoo's MediaPipe person detector."""
import os
import sys
import struct

ROOT = os.environ.get('BOT_ROOT') or os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, '.cv-deps'))
sys.path.insert(0, os.path.join(ROOT, 'detector-models'))

import cv2 as cv
import numpy as np
from mp_persondet import MPPersonDet


def has_people(detector, data):
    image = cv.imdecode(np.frombuffer(data, dtype=np.uint8), cv.IMREAD_COLOR)
    if image is None:
        raise ValueError('Не удалось прочитать изображение')
    height, width = image.shape[:2]
    found = detector.infer(image)
    visible = any(
        item[-1] >= 0.65 and item[2] > item[0] and item[3] > item[1]
        and max(0, min(width, item[2]) - max(0, item[0]))
        * max(0, min(height, item[3]) - max(0, item[1])) >= width * height * 0.005
        for item in found
    )
    return visible


def read_exact(length):
    chunks = bytearray()
    while len(chunks) < length:
        chunk = sys.stdin.buffer.read(length - len(chunks))
        if not chunk:
            raise EOFError('Оборванное изображение')
        chunks.extend(chunk)
    return chunks


def main():
    # Avoid oversubscribing a small VM; the model stays loaded between requests.
    cv.setNumThreads(1)
    model = os.path.join(ROOT, 'detector-models', 'person_detection_mediapipe_2023mar.onnx')
    detector = MPPersonDet(model, scoreThreshold=0.65)
    if '--worker' not in sys.argv:
        print('PASS' if has_people(detector, sys.stdin.buffer.read()) else 'REJECT')
        return
    while True:
        first = sys.stdin.buffer.read(1)
        if not first:
            return
        length = struct.unpack('>I', first + read_exact(3))[0]
        if not 0 < length <= 24 * 1024 * 1024:
            raise ValueError('Недопустимый размер изображения')
        print('PASS' if has_people(detector, read_exact(length)) else 'REJECT', flush=True)


if __name__ == '__main__':
    main()
