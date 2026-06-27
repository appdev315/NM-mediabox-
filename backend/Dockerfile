FROM mcr.microsoft.com/playwright:v1.61.0-jammy

# Используем встроенного пользователя Playwright с UID 1000
USER root
RUN apt-get update && apt-get install -y unzip && rm -rf /var/lib/apt/lists/*

USER pwuser
ENV HOME=/home/pwuser \
    PATH=/home/pwuser/.local/bin:$PATH

WORKDIR $HOME/app

COPY --chown=pwuser package*.json ./
RUN npm install

COPY --chown=pwuser . .

EXPOSE 7860
ENV PORT=7860

CMD ["node", "index.js"]
