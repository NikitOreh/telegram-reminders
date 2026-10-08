"""Classify an image locally with OpenCV Zoo's MediaPipe person detector."""
import os
import sys

ROOT = os.environ.get('BOT_ROOT') or os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, '.cv-deps'))
sys.path.insert(0, os.path.join(ROOT, 'detector-models'))

import cv2 as cv
import numpy as np
from mp_persondet import MPPersonDet


def main():
    image = cv.imdecode(np.frombuffer(sys.stdin.buffer.read(), dtype=np.uint8), cv.IMREAD_COLOR)
    if image is None:
        raise ValueError('Не удалось прочитать изображение')
    model = os.path.join(ROOT, 'detector-models', 'person_detection_mediapipe_2023mar.onnx')
    detector = MPPersonDet(model, scoreThreshold=0.65)
    height, width = image.shape[:2]
    found = detector.infer(image)
    visible = any(
        item[-1] >= 0.65 and item[2] > item[0] and item[3] > item[1]
        and max(0, min(width, item[2]) - max(0, item[0]))
        * max(0, min(height, item[3]) - max(0, item[1])) >= width * height * 0.005
        for item in found
    )
    print('PASS' if visible else 'REJECT')


if __name__ == '__main__':
    main()
