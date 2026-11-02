# P on the NAS's CPU (server.py). Its own image, so ACM's stays small and an ACM rebuild doesn't touch these layers.
# torch's CPU build and the same transformers as acm-gpu's lock file, so its scores match acm-gpu's.
FROM python:3.12-slim

RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir transformers==5.17.0 pillow==12.2.0

ENV HF_HOME=/cache
COPY server.py /app/server.py
CMD ["python", "-u", "/app/server.py"]
