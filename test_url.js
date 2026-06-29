function isValidUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        const hostname = parsed.hostname;
        const allowedDomains = ['kinozuma.net', 'kinovasek.net', 'anwap.tube', 'anwap.im', 'anwap.bio', 'anwap.site', 'anwap.pm', 'anwap.best', 'mj.anwap.today', 'mm.anwap.media', 'm.anwap.media'];
        
        if (allowedDomains.includes(hostname)) return true;
        
        const allowedSuffixes = ['.anwap.tube', '.kinozuma.net', '.kinovasek.net'];
        for (const suffix of allowedSuffixes) {
            if (hostname.endsWith(suffix)) return true;
        }
        
        return false;
    } catch (e) {
        return false;
    }
}
console.log(isValidUrl("http://kinozuma.net")); // true
console.log(isValidUrl("http://localhost.kinozuma.net")); // true
console.log(isValidUrl("http://evil.com")); // false
console.log(isValidUrl("http://evil.kinozuma.net.com")); // false
console.log(isValidUrl("http://evilcom.kinozuma.net")); // true
