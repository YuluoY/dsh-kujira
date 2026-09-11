import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
export default [
 {ignores:['node_modules/**','lib/shared/vendor/**']},
 js.configs.recommended,
 {languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node}},rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_',caughtErrors:'none',varsIgnorePattern:'^_'}],'no-empty':['error',{allowEmptyCatch:true}]}},
 {files:['lib/client.js','lib/shared/client/**/*.js','lib/shared/task/**/*.js'],plugins:{'react-hooks':reactHooks},rules:{'react-hooks/rules-of-hooks':'error'}},
 {files:['lib/shared/client/**/*.js','lib/shared/task/**/*.js','lib/shared/locales/*.js'],rules:{'max-lines':['error',{max:500,skipBlankLines:true,skipComments:true}]}}
];
