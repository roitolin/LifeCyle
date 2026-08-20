const fs = require('fs');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('./src');

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    content = content.replace(/\.map\(\((item|doc|itemDoc|conversationDoc|messageDoc|userDoc|notificationDoc)\) =>/g, '.map(($1: any) =>');
    content = content.replace(/\.filter\(\((item|doc|itemDoc)\) =>/g, '.filter(($1: any) =>');
    content = content.replace(/\.sort\(\((a, b|a,\s*b)\) =>/g, '.sort((a: any, b: any) =>');
    content = content.replace(/\.forEach\(\((item|doc|itemDoc|userDoc|messageDoc|conversationDoc|notificationDoc|ratingDoc|feedbackDoc|replyDoc)\) =>/g, '.forEach(($1: any) =>');
    content = content.replace(/\.reduce\(\((acc, item)\) =>/g, '.reduce((acc: any, item: any) =>');

    if (content !== original) {
        fs.writeFileSync(file, content);
        console.warn('Updated: ' + file);
    }
});
