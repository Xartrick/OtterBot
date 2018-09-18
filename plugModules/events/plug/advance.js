const { Op } = require("sequelize");
const {
  isObject, isNaN, isNil, get, keys,
} = require("lodash");

var savedMessageID;
var savedMessage;

module.exports = function Event(bot, filename, platform) {
  const event = {
    name: bot.plug.events.ADVANCE,
    platform,
    _filename: filename,
    run: async (data) => {
      if (!isObject(data) || !isObject(data.media) || !isObject(data.currentDJ)) return;

      bot.plug.woot();

      clearTimeout(bot.autoSkipTimeout);

      let songAuthor = null;
      let songTitle = null;

      if (get(data, "media.format", 2) === 1) {
        const YouTubeMediaData = await bot.youtube.getMedia(data.media.cid);

        const { snippet } = YouTubeMediaData; // eslint-disable-line no-unused-vars
        const fullTitle = get(YouTubeMediaData, "snippet.title");

        songAuthor = fullTitle.split(" - ")[0].trim();
        songTitle = fullTitle.split(" - ")[1].trim();
      } else {
        const SoundCloudMediaData = await bot.soundcloud.getTrack(data.media.cid);

        if (!isNil(SoundCloudMediaData)) {
          const fullTitle = SoundCloudMediaData.title;

          songAuthor = fullTitle.split(" - ")[0].trim();
          songTitle = fullTitle.split(" - ")[1].trim();
        }
      }

      if (isNil(songAuthor) || isNil(songTitle)) {
        songAuthor = data.media.author;
        songTitle = data.media.title;
      }

      if (!isNil(bot.user)) {
        bot.user.setActivity(`${songAuthor} - ${songTitle}`, {
          type: "LISTENING"
        }).catch(function(error) {
          console.log(error);
        });
      }

      const blacklisted = await bot.db.models.blacklist.findOne({ where: { cid: data.media.cid }});

      if (isObject(blacklisted)) {
        await bot.plug.sendChat(`@${data.currentDJ.username} ` + bot.lang.blacklisted);
        await bot.plug.moderateForceSkip();
      }

      if (isObject(data.currentDJ) && data.media.duration >= 390) {
        await bot.plug.sendChat(`@${data.currentDJ.username} ` + bot.lang.exceedstimeguard);
        await bot.utils.lockskip(data.currentDJ);
      }

      const songHistory = await bot.db.models.plays.findAll({
        where: {
          created_at: {
            [Op.gt]: bot.moment().subtract(360, "minutes").toDate()
          }
        },
        order: [["created_at", "ASC"]],
      });

      if (!isNil(songHistory)) {
        for (let i = 0; i < songHistory.length; i++) {
          const playedMinutes = bot.moment().diff(bot.moment(songHistory[i].created_at), "minutes");

          if (!isNil(songHistory[i].title)) {
            if (playedMinutes <= 360) {
              const currentAuthor = songAuthor.replace(/ *\([^)]*\) */g, "").replace(/\[.*?\]/g, "").trim();
              const savedAuthor = songHistory[i].author.replace(/ *\([^)]*\) */g, "").replace(/\[.*?\]/g, "").trim();

              const currentTitle = songTitle.replace(/ *\([^)]*\) */g, "").replace(/\[.*?\]/g, "").trim();
              const savedTitle = songHistory[i].title.replace(/ *\([^)]*\) */g, "").replace(/\[.*?\]/g, "").trim();

              if (songHistory.cid === data.media.cid) {
                // Song Played | Same ID
                await bot.plug.chat(bot.utils.replace(bot.lang.historySkip, {
                  time: bot.moment(songHistory[i].created_at).fromNow(),
                }));
                //await bot.plug.moderateForceSkip();
                break;
              }

              if ((savedTitle === currentTitle) && (savedAuthor === currentAuthor) && (songHistory[i].cid !== data.media.cid)) {
                // Same Song | Diff CID | Diff Remix/Channel
                await bot.plug.chat(bot.utils.replace(bot.lang.historySkip, {
                  time: bot.moment(songHistory[i].created_at).fromNow(),
                }));
                //await bot.plug.moderateForceSkip();
                break;
              }

              if ((savedTitle === currentTitle) && (savedAuthor !== currentAuthor) && (songHistory[i].cid !== data.media.cid)) {
                // Same Song Name/Maybe diff Author
                if (songHistory[i].format === 1) {
                  await bot.plug.chat(bot.utils.replace(bot.lang.maybeHistorySkip, {
                    cid: songHistory[i].cid,
                    time: bot.moment(songHistory[i].created_at).fromNow(),
                  }));
                  break;
                }
              }
            }
          }
        }
      }

      const savedCID = data.media.cid;

      setTimeout(async () => {
        const currentMedia = bot.plug.getMedia();

        if (savedCID === get(currentMedia, "cid")) {
          await bot.plug.sendChat(bot.lang.stuckSkip);
          await bot.plug.moderateForceSkip();
        }
      }, (data.media.duration + 5) * 1e3);

      try {
        // get history for the latest play

        const lastPlay = data.lastPlay; //await bot.plug.getHistory();

        // if plug reset the history or its a brand new room it won't have history
        if (isNil(lastPlay.media)) return;

        //const [lastPlay] = history;
        
        // save how much XP they got for their play
        const score = keys(bot.points.votes).length + 1;
        const ids = keys(bot.points.votes).map(k => parseInt(k, 10)).filter(i => !isNaN(i));

        // empty the XP counter
        bot.points.votes = {};

        // reset any DC spots when they start DJing
        await bot.redis.removeDisconnection(lastPlay.dj.id);
        await bot.redis.removeGivePosition(lastPlay.dj.id);

        let lastSongAuthor = null;
        let lastSongTitle = null;

        if (get(lastPlay, "media.format", 2) === 1) {
          const lastYouTubeMediaData = await bot.youtube.getMedia(lastPlay.media.cid);
  
          const { snippet } = lastYouTubeMediaData; // eslint-disable-line no-unused-vars
          const lastFullTitle = get(lastYouTubeMediaData, "snippet.title");
  
          lastSongAuthor = lastFullTitle.split(" - ")[0].trim();
          lastSongTitle = lastFullTitle.split(" - ")[1].trim();
        } else {
          const lastSoundCloudMediaData = await bot.soundcloud.getTrack(lastPlay.media.cid);
  
          if (!isNil(lastSoundCloudMediaData)) {
            const lastFullTitle = lastSoundCloudMediaData.title;
  
            lastSongAuthor = lastFullTitle.split(" - ")[0].trim();
            lastSongTitle = lastFullTitle.split(" - ")[1].trim();
          }
        }

        if (isNil(lastSongAuthor) || isNil(lastSongTitle)) {
          lastSongAuthor = lastPlay.media.author;
          lastSongTitle = lastPlay.media.title;
        }

        // keep track of played media in the room
        await bot.db.models.plays.create({
          cid: lastPlay.media.cid,
          format: lastPlay.media.format,
          woots: lastPlay.score.positive,
          grabs: lastPlay.score.grabs,
          mehs: lastPlay.score.negative,
          dj: lastPlay.dj.id,
          skipped: lastPlay.score.skipped > 0,
          author: `${lastSongAuthor}`,
          title: `${lastSongTitle}`,
        });

        // count how many props were given while that media played
        const props = await bot.db.models.props.count({
          where: { historyID: `'${lastPlay.media.id}'`, dj: lastPlay.dj.id },
        });

        // get an user object for the last DJ
        const [instance] = await bot.db.models.users.findOrCreate({
          where: { id: lastPlay.dj.id }, defaults: { id: lastPlay.dj.id, username: lastPlay.dj.username },
        });
        
        const woots = lastPlay.score.positive;
        const grabs = lastPlay.score.grabs;
        const mehs = lastPlay.score.negative;

        if (!isNil(savedMessageID)) {
          if (lastPlay.score.skipped === 1) {
            bot.channels.get("486125808553820160").fetchMessage(savedMessageID)
              .then(message => message.edit(savedMessage.replace("is now Playing", "Played") + " Skipped!"));
          } else {
            bot.channels.get("486125808553820160").fetchMessage(savedMessageID)
              .then(message => message.edit(savedMessage.replace("is now Playing", "Played") + " <:plugWoot:486538570715103252> " + woots + " " + "<:plugMeh:486538601044115478> " + mehs + " " + "<:plugGrab:486538625270677505> " + grabs + "\n"));
          }
        }
        
        bot.channels.get("486125808553820160").send("**" + data.currentDJ.username + " (" + data.currentDJ.id + ")** is now Playing: " + `${data.media.author} - ${data.media.title}`).then(m => {
          savedMessageID = m.id;
          savedMessage = m.content;
        });
        
        // if they weren't skipped they deserve XP equivalent to the votes
        if (!lastPlay.score.skipped) {
          const previousScore = instance.get("points");
          await instance.increment("points", { by: score });
          if (previousScore < 10000) {
            bot.points.incrementHook(instance);
          }

          // award users that voted their XP
          await bot.db.models.users.increment("points", { by: 1, where: { id: { [Op.in]: ids } } });

          // if no props were given, we done here
          if (!props) return;

          // otherwise, give them the props
          await instance.increment("props", { by: props });

          await bot.plug.sendChat(bot.utils.replace(bot.lang.advanceprops, {
            props,
            user: lastPlay.dj.username,
            plural: props > 1 ? "s" : "",
          }), data.media.duration * 1e3);
        }
      } catch (err) {
        console.error(err);
      }
    },
    init() {
      bot.plug.on(this.name, this.run);
    },
    kill() {
      bot.plug.removeListener(this.name, this.run);
    },
  };

  bot.events.register(event);
};