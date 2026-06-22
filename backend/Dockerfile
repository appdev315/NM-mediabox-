FROM mcr.microsoft.com/playwright:v1.44.0-jammy

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

COPY --chown=user package*.json ./
RUN npm install

COPY --chown=user . .

EXPOSE 7860
ENV PORT=7860

CMD ["node", "index.js"]
