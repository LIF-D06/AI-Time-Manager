module.exports = {
  presets: [
    ["@babel/preset-env", {
      "modules": false
    }],
    "@babel/preset-typescript"
  ],
  plugins: [
    [
      "module-resolver",
      {
        extensions: [".js", ".ts"],
        resolvePath: (sourcePath, currentFile, opts) => {
          // 如果是相对路径导入且不是node_modules
          if (sourcePath.startsWith('./') && !sourcePath.includes('node_modules')) {
            // 检查是否已经有扩展名
            if (!sourcePath.endsWith('.js') && !sourcePath.endsWith('.ts')) {
              return sourcePath + '.js';
            }
          }
          return sourcePath;
        }
      }
    ]
  ]
};