#!/usr/bin/env node

import xray from 'x-ray';
import _ from 'lodash';

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
      this.scraper('https://en.wikipedia.org/wiki/ISO_3166-1',
        'h3:has(#Officially_assigned_code_elements) ~ table.wikitable:first-of-type > tr',
        [{
          englishShortName: 'td:nth-child(1)',
          isoTwoLetterCountryCode: 'td:nth-child(2)',
          isoThreeLetterCountryCode: 'td:nth-child(3)',
          isoThreeDigitCountryCode: 'td:nth-child(4)',
          isoCountrySubdivisionCode: 'td:nth-child(5)',
          wikipediaSlug: 'td:nth-child(1) > a@href',
        }])((error, data) => {
          if (!error) {
            const countries = _.map(data, (country) => {
              country.wikipediaSlug = country.wikipediaSlug.substring(country.wikipediaSlug.lastIndexOf('/') + 1);

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
