#!/usr/bin/env node

import xray from 'x-ray';
import _ from 'lodash';
import url from 'url';

class Scraper {
  constructor() {
    this.countries = [];
    this.scraper = xray();
  }

  /**
  * getCountries() scrapes names and codes of countries from the Web.
  *
  * @param {Function} callback
  */
  getCountries(callback) {
    if (!this.countries.length) {
      const WIKIPEDIA_PREFIX = 'https://en.wikipedia.org/wiki/';
      const DBPEDIA_PREFIX   = 'http://dbpedia.org/resource/';

      this.scraper(url.resolve(WIKIPEDIA_PREFIX, 'ISO_3166-1'),
        'h3:has(#Officially_assigned_code_elements) ~ table.wikitable:first-of-type > tr',
        [{
          english_short_name      : 'td:nth-child(1)',
          iso_3166_1_alpha_2      : 'td:nth-child(2)',
          iso_3166_1_alpha_3      : 'td:nth-child(3)',
          iso_3166_1_numeric      : 'td:nth-child(4)',
          iso_3166_2              : 'td:nth-child(5)',
          dbpedia_url             : 'td:nth-child(1) > a@href',
          wikipedia_iso_3166_2_url: 'td:nth-child(5) > a@href',
        }])((error, data) => {
          if (!error) {
            const countries = _.map(data, (country) => {
              const base = country.dbpedia_url.substring(country.dbpedia_url.lastIndexOf('/') + 1);
              country.dbpedia_url = url.resolve(DBPEDIA_PREFIX, base);

              return country;
            });

            this.countries = countries;
          }
          callback(error, this.countries);
        });
    } else {
      callback(null, this.countries);
    }
  }
}

export default Scraper;
