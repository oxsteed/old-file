'use strict';
// Invoked only through asm-exec. stdout is an authenticated ciphertext, never
// credentials. The parent process keeps decrypted values in runtime memory.
const {encrypt}=require('../utils/encryption');
const names=['accessToken','refreshToken','clientId','clientSecret','webhookSecret'];
const values=Object.fromEntries(names.map((name,i)=>[name,process.env[`PROVIDER_REF_${i}`]||'']));
if(Object.values(values).some(v=>v.includes('{{resolve:')))process.exit(2);
process.stdout.write(encrypt(JSON.stringify(values)));
