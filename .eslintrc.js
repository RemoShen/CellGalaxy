module.exports = {
  extends: [
    'react-app',
    'react-app/jest'
  ],
  rules: {
    'react-hooks/exhaustive-deps': 'off' // 关闭这个规则，避免每次启动都报错
  }
};
