
const fetch = require('node-fetch');
const fs = require('fs');
const config = require('./config.json');
const { symbols } = require('./currency-symbols.json');

(async() => {
    const res = await fetch('https://api.apilayer.com/exchangerates_data/latest?base=USD', {
        headers: { apikey: config.exchangerates_key }
    });
    const json = await res.json();
    const values = json.rates;
    Object.keys(symbols).forEach((id) => {
        config.units.currency.units[id.toLowerCase()] = {
            name: `${symbols[id]} (${id})`,
            toBase: `x/${values[id]}`,
            saveCase: true
        }
    });
    //fs.writeFileSync('./currency-values.json', JSON.stringify(json, null, 4));
    fs.writeFileSync('./config.json', JSON.stringify(config, null, 4));
})();