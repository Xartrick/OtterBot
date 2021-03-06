module.exports = function Command(bot) {
  bot.plugCommands.register({
    names: ["ignore"],
    minimumPermission: 2000,
    cooldownType: "perUse",
    cooldownDuration: 60,
    parameters: "",
    description: "Ignore history check next song",
    async execute() {
      bot.global.ignoreHistoryNext = true;

      await bot.plug.sendChat("History check will be disabled next song.");
      return true;
    },
  });
};