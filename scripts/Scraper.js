#!/usr/bin/env node

import 'babel-polyfill';
import xray from 'x-ray';
import rdf from 'rdflib';

class Scraper {
  constructor() {
    this.countries = [];
    this.scraper = xray();
  }

  /**
  * _getCountryList() scrapes names and codes of countries in ISO 3166-1 from Wikipedia.
  */
  _getCountryList() {
    return new Promise((resolve, reject) => {
      this.scraper('https://en.wikipedia.org/wiki/ISO_3166-1',
        'h3:has(#Officially_assigned_code_elements) ~ table.wikitable:first-of-type > tr',
        [{
          englishShortName: 'td:nth-child(1)',
          isoTwoLetterCountryCode: 'td:nth-child(2)',
          isoThreeLetterCountryCode: 'td:nth-child(3)',
          isoThreeDigitCountryCode: 'td:nth-child(4)',
          isoCountrySubdivisionCode: 'td:nth-child(5)',
          _wikipediaUri: 'td:nth-child(1) a@href',
        }])((error, data) => {
          if (error) {
            reject(error);
          } else {
            resolve(data);
          }
        });
    });
  }

  _getWikidataIds(countries) {
    const promises = [];

    countries.map((country) => {
      promises.push(new Promise((resolve, reject) => {
        const scraper = xray();
        scraper(country._wikipediaUri, {
          wikipediaSlug: 'link[rel="canonical"]@href',
          wikidataId: '#t-wikibase > a@href',
        })((error, data) => {
          if (error) {
            reject(error);
          } else {
            country.wikipediaSlug = data.wikipediaSlug.substring(data.wikipediaSlug.lastIndexOf('/') + 1);
            country.wikidataId = data.wikidataId.substring(data.wikidataId.lastIndexOf('/') + 1);
            delete country._wikipediaUri;

            resolve(country);
          }
        });
      }));
    });

    return Promise.all(promises);
  }

  getCountries() {
    if (!this.countries.length) {
      return this._getCountryList()
        .then((countries) => {
          return this._getWikidataIds(countries);
        })
        .then((countries) => {
          this.countries = countries;
          return this.countries;
        });
    }

    return Promise.resolve(this.countries);
  }
}

export default Scraper;
