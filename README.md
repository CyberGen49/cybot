# Cybot
A Discurd bot that adds a whole bunch of useful commands.

The intention isn't for others to run their own instance of this bot, but if you want to, you can.

Read more about the bot and add it to your server [here](https://cybot.simplecyber.org).

## Running the bot
1. Clone the repository
2. Run `npm install`
3. Rename `config.template.json` to `config.json` and fill in the values
    * Leaving any of the values blank will cause their respective features to break
4. Build the shortener database by running `sqlite3 shortener.db < shortener.sql`
5. Download and build the dictionary database by following the commented instructions in `dictionary.sql`
6. Run `npm start` to start the bot