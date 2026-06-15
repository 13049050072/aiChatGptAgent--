const https = require('https');

class MailCxClient {
  constructor() {
    this.API_BASE = "api.mail.cx";
    this.EMAIL_DOMAIN = "end.tw";
    this.apiTokenInfo = { token: null, lastFetched: 0 };
  }

  request(options, postData = null) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              resolve(data);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
    });
  }

  async fetchAndSetNewToken() {
    const options = {
      hostname: this.API_BASE,
      path: '/api/v1/auth/authorize_token',
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }
    };
    const token = await this.request(options, '{}');
    this.apiTokenInfo.token = token;
    this.apiTokenInfo.lastFetched = Date.now();
    return token;
  }

  async getValidToken() {
    const timeSinceLastFetch = (Date.now() - this.apiTokenInfo.lastFetched) / (1000 * 60);
    if (!this.apiTokenInfo.token || timeSinceLastFetch > 3) {
      return await this.fetchAndSetNewToken();
    }
    return this.apiTokenInfo.token;
  }

  async fetchWithAutoToken(path, method = 'GET', body = null, retries = 1) {
    const token = await this.getValidToken();
    const options = {
      hostname: this.API_BASE,
      path: path,
      method: method,
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
    };
    try {
      return await this.request(options, body);
    } catch (error) {
      if (error.message.includes('401') && retries > 0) {
        await this.fetchAndSetNewToken();
        return await this.fetchWithAutoToken(path, method, body, retries - 1);
      }
      return null;
    }
  }

  generateRandomUsername(length = 10) {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let username = '';
    for (let i = 0; i < length; i++) {
      username += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return username;
  }

  createNewEmail() {
    const username = this.generateRandomUsername();
    return `${username}@${this.EMAIL_DOMAIN}`;
  }

  async getMessages(emailAddress) {
    return await this.fetchWithAutoToken(`/api/v1/mailbox/${emailAddress}`);
  }

  async getMessageSource(emailAddress, messageId) {
    return await this.fetchWithAutoToken(`/api/v1/mailbox/${emailAddress}/${messageId}/source`);
  }

  decodeQuotedPrintable(text) {
    let decodedText = text.replace(/=\r?\n/g, '');
    decodedText = decodedText.replace(/=([A-F0-9]{2})/g, (match, p1) => {
      try {
        return String.fromCharCode(parseInt(p1, 16));
      } catch (e) {
        return match;
      }
    });
    return decodedText;
  }

  async getLatestVerificationInfo(emailAddress) {
    const messages = await this.getMessages(emailAddress);
    if (!messages || messages.length === 0) {
      return { status: 'not_found', message: 'No messages found' };
    }

    const sortedMessages = messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestMessage = sortedMessages[0];
    const sourceContent = await this.getMessageSource(emailAddress, latestMessage.id);
    if (!sourceContent) {
      return { status: 'error', message: 'Failed to fetch message source' };
    }

    const decodedContent = this.decodeQuotedPrintable(sourceContent);

    // 匹配验证码
    const subjectMatch = decodedContent.match(/Subject:.*?verification code is ([A-Z0-9]{6})/i);
    if (subjectMatch && subjectMatch[1]) {
      return { status: 'success', type: 'code', value: subjectMatch[1] };
    }

    const spanMatch = decodedContent.match(/<span[^>]*>([A-Z0-9]{6})<\/span>/i);
    if (spanMatch && spanMatch[1]) {
      return { status: 'success', type: 'code', value: spanMatch[1] };
    }

    const codeTextMatch = decodedContent.match(/(?:Your verification code|verification code)[:：]\s*([A-Z0-9]{6})/i);
    if (codeTextMatch && codeTextMatch[1]) {
      return { status: 'success', type: 'code', value: codeTextMatch[1] };
    }

    const allMatches = decodedContent.match(/\b[A-Z0-9]{6}\b/gi);
    if (allMatches && allMatches.length > 0) {
      const filteredMatches = allMatches.filter(match => {
        const context = decodedContent.substring(
          Math.max(0, decodedContent.indexOf(match) - 50),
          decodedContent.indexOf(match) + match.length + 50
        );
        return !context.includes('http') && !context.includes('cdn') && !context.includes('.com');
      });
      if (filteredMatches.length > 0) {
        return { status: 'success', type: 'code', value: filteredMatches[0] };
      }
    }

    return { status: 'not_found', message: 'No verification code found' };
  }
}

module.exports = new MailCxClient();
