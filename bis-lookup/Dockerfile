FROM python:3.11-slim
# opencv-python (a ddddocr dependency) needs these shared libraries.
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import ddddocr; ddddocr.DdddOcr(show_ad=False)"
COPY app.py index.html ./
CMD ["python", "app.py"]
