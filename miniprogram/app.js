// app.js
App({
  onLaunch() {
    this.globalData = {
      // 云开发环境 ID：在微信开发者工具右上角「云开发」控制台查看，
      // 将下方 env 改成你的环境 ID，例如 env: "dota2-xxxxx"
      env: "",
    };
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }
  },
});
