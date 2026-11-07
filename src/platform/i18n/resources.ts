import enAuth from './locales/en/auth.json';
import enMail from './locales/en/mail.json';
import zhCnMail from './locales/zh-CN/mail.json';
import enCommon from './locales/en/common.json';
import zhCnAuth from './locales/zh-CN/auth.json';
import zhCnCommon from './locales/zh-CN/common.json';
import enMcpViews from './locales/en/mcp-views.json';
import zhCnMcpViews from './locales/zh-CN/mcp-views.json';

export const resources = {
  en: { auth: enAuth, common: enCommon, mail: enMail, mcpViews: enMcpViews },
  'zh-CN': {
    auth: zhCnAuth,
    common: zhCnCommon,
    mail: zhCnMail,
    mcpViews: zhCnMcpViews,
  },
};
