#!/usr/bin/env node

import 'babel-polyfill';
import _ from 'lodash';
import xray from 'x-ray';

import rdf from 'rdf-ext';
import RdfXmlParser from 'rdf-parser-rdfxml';
rdf.parsers = new rdf.Parsers({
  'application/rdf+xml': RdfXmlParser,
});

import SparqlStore from 'rdf-store-sparql';

class Scraper {
  constructor() {
    this.countries = [];
    this.scraper = xray();
  }

  /**
  * _getCountryList() scrapes names and codes of countries in ISO 3166-1 from Wikipedia.
  *
  * @access private
  * @return {Promise}
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

  /**
  * _getWikiIds() scrapes the Wikipedia canonical slug and the Wikidata ID of each country.
  *
  * @access private
  * @param {Array} countries
  * @return {Promise} a promise that waits for all promises for countries to be fulfilled
  */
  _getWikiIds(countries) {
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
            const newCountry = _.cloneDeep(country);
            delete newCountry._wikipediaUri;

            const wikipediaSlug = _.trimRight(data.wikipediaSlug, '/');
            newCountry.wikipediaSlug = wikipediaSlug.substring(wikipediaSlug.lastIndexOf('/') + 1);

            const wikidataId = _.trimRight(data.wikidataId, '/');
            newCountry.wikidataId = wikidataId.substring(wikidataId.lastIndexOf('/') + 1);

            resolve(newCountry);
          }
        });
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _getGeoNamesIds() scrapes the GeoNames ID of each country.
  *
  * @access private
  * @param {Array} countries
  * @return {Promise} a promise that waits for all promises for countries to be fulfilled
  */
  _getGeoNamesIds(countries) {
    const promises = [];

    countries.map((country) => {
      promises.push(new Promise((resolve, reject) => {
        const newCountry = _.cloneDeep(country);

        // Exception handling for Taiwan (cf. https://en.wikipedia.org/wiki/ISO_3166-1#cite_note-18)
        if (/TW/i.test(newCountry.isoTwoLetterCountryCode)) {
          newCountry.geoNamesId = '1668284';
          resolve(newCountry);
        } else {
          const dbpediaGraphUri = 'http://wikidata.dbpedia.org';
          const dbpediaUri = `${dbpediaGraphUri}/resource/${newCountry.wikidataId}`;
          const store = new SparqlStore({
            endpointUrl: 'http://wikidata.dbpedia.org/sparql',
            // The SPARQL endpoint of DBpedia cannot support "application/n-triples".
            mimeType: 'text/plain',
          });

          store.match(dbpediaUri, rdf.resolve('owl:sameAs'), undefined, dbpediaGraphUri).then((graph) => {
            const filtered = graph.filter((triple) => {
              return triple.object.toString().match(/http:\/\/sws\.geonames\.org/i);
            }).toArray();

            if (!filtered.length) {
              throw new Error(`Cannot find a GeoNames ID for this country: ${newCountry.englishShortName}`);
            }

            const geoNamesUrl = _.trimRight(filtered[0].object.toString(), '/');
            newCountry.geoNamesId = geoNamesUrl.substring(geoNamesUrl.lastIndexOf('/') + 1);

            resolve(newCountry);
          }).catch((exception) => {
            reject(exception);
          });
        }
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _getGeoNamesData() scrapes the data of each country from GeoNames.
  *
  * @access private
  * @param {Array} countries
  * @return {Promise} a promise that waits for all promises for countries to be fulfilled
  */
  _getGeoNamesData(countries) {
    const promises = [];

    countries.map((country) => {
      promises.push(new Promise((resolve, reject) => {
        const newCountry = _.cloneDeep(country);
        const geoNamesUri = `http://sws.geonames.org/${newCountry.geoNamesId}/`;

        rdf.defaultRequest('get', `${geoNamesUri}about.rdf`).then((response) => {
          return rdf.parsers.parse('application/rdf+xml', response.content);
        }).then((graph) => {
          // TODO: Serialize the graph model in JSON
          graph.forEach((triple) => {
            if (triple.predicate.equals('http://www.geonames.org/ontology#name')) {
              newCountry.name = triple.object.toString();
            } else if (triple.predicate.equals('http://www.geonames.org/ontology#officialName')) {
              newCountry[`officialName${_.capitalize(triple.object.language)}`] = triple.object.toString();
            } else if (triple.predicate.equals('http://www.geonames.org/ontology#shortName')) {
              newCountry[`shortName${_.capitalize(triple.object.language)}`] = triple.object.toString();
            } else if (triple.predicate.equals('http://www.geonames.org/ontology#alternateName')) {
              newCountry[`alternateName${_.capitalize(triple.object.language)}`] = triple.object.toString();
            } else if (triple.predicate.equals('http://www.w3.org/2003/01/geo/wgs84_pos#lat')) {
              newCountry.lat = parseFloat(triple.object.toString());
            } else if (triple.predicate.equals('http://www.w3.org/2003/01/geo/wgs84_pos#long')) {
              newCountry.long = parseFloat(triple.object.toString());
            }
          });

          resolve(newCountry);
        }).catch((exception) => {
          reject(exception);
        });
      }));
    });

    return Promise.all(promises);
  }

  /**
  * getCountries() scrapes data about countries in ISO 3166-1.
  *
  * @access public
  * @return {Promise}
  */
  getCountries() {
    if (!this.countries.length) {
      return this._getCountryList()
        .then((countries) => {
          return this._getWikiIds(countries);
        })
        .then((countries) => {
          return this._getGeoNamesIds(countries);
        })
        .then((countries) => {
          return this._getGeoNamesData(countries);
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
