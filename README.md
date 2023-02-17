# Cybot
A Discurd bot that adds a whole bunch of useful commands.

## [Add the bot to your server](https://cybot.simplecyber.org)

The intention of this repository isn't for others to run their own instance of Cybot, but if you want to, you can. You'll get a better experience by using the instance linked above.

## Running the bot
1. Clone the repository
2. Run `npm install`
3. Rename `config.template.json` to `config.json` and fill in the values
    * Leaving any of the values blank will cause their respective features to break
4. Build the shortener database by running `sqlite3 shortener.db < shortener.sql`
5. Download and build the dictionary database by following the commented instructions in `dictionary.sql`
6. Run `npm start` to start the bot