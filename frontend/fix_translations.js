const fs = require('fs');
const path = './src/context/LanguageContext.tsx';
let content = fs.readFileSync(path, 'utf8');

const replacements = {
  'ko-KR': '"privateBotTitle": "비공개 VIP 클럽"',
  'id-ID': '"privateBotTitle": "Klub VIP Pribadi"',
  'hi-IN': '"privateBotTitle": "निजी वीआईपी क्लब"',
  'de-DE': '"privateBotTitle": "Privater VIP-Club"',
  'fr-FR': '"privateBotTitle": "Club VIP Privé"'
};

for (const [lang, repl] of Object.entries(replacements)) {
  // Find the line starting with `'lang':` and replace the bad string in it
  const regex = new RegExp(`('${lang}':.*?)"privateBotTitle": "Приватный VIP Клуб"`);
  content = content.replace(regex, `$1${repl}`);
}

fs.writeFileSync(path, content, 'utf8');
