#!/usr/bin/env node

import 'babel-polyfill';
import _ from 'lodash';
import xray from 'x-ray';

// import superagent from 'superagent';
// import superagentRetry from 'superagent-retry';
// const request = superagentRetry(superagent);
// superagentRetry.retries.push(function internalServerError(error, response) {
//   return response && response.status === 500;
// });

import SparqlStore from 'rdf-store-sparql';

import rdf from 'rdf-ext';
import N3Parser from 'rdf-parser-n3';
import RdfXmlParser from 'rdf-parser-rdfxml';
rdf.parsers = new rdf.Parsers({
  'text/n3': N3Parser,
  'text/turtle': N3Parser,
  'application/n-triples': N3Parser,
  'application/rdf+xml': RdfXmlParser,
});

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
            const refCountry = country;
            delete refCountry._wikipediaUri;

            const wikipediaSlug = _.trimRight(data.wikipediaSlug, '/');
            refCountry.wikipediaSlug = wikipediaSlug.substring(wikipediaSlug.lastIndexOf('/') + 1);

            const wikidataId = _.trimRight(data.wikidataId, '/');
            refCountry.wikidataId = wikidataId.substring(wikidataId.lastIndexOf('/') + 1);

            resolve(refCountry);
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
        const refCountry = country;

        // Exception handling for Taiwan (cf. https://en.wikipedia.org/wiki/ISO_3166-1#cite_note-18)
        if (/TW/i.test(refCountry.isoTwoLetterCountryCode)) {
          refCountry.geoNamesId = '1668284';
          resolve(refCountry);
        } else {
          const dbpediaGraphUri = 'http://wikidata.dbpedia.org';
          const dbpediaUri = `${dbpediaGraphUri}/resource/${refCountry.wikidataId}`;
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
              throw new Error(`Cannot find a GeoNames ID for this country: ${refCountry.englishShortName}`);
            }

            const geoNamesUrl = _.trimRight(filtered[0].object.toString(), '/');
            refCountry.geoNamesId = geoNamesUrl.substring(geoNamesUrl.lastIndexOf('/') + 1);

            resolve(refCountry);
          }).catch((exception) => {
            reject(exception);
          });

          // request.get(dbpediaUri)
          //   .accept('text/turtle, text/n3, application/rdf+xml, application/n-triples')
          //   .buffer(true)
          //   .retry(5)
          //   .end((error, response) => {
          //     if (error) {
          //       reject(error);
          //     } else {
          //       rdf.parsers.parse(response.type, response.text).then((graph) => {
          //         const filtered = graph.filter((triple) => {
          //           return triple.subject.equals(dbpediaUri) &&
          //             triple.predicate.equals(rdf.resolve('owl:sameAs')) &&
          //             triple.object.toString().match(/http:\/\/sws\.geonames\.org/i);
          //         }).toArray();
          //
          //         if (!filtered.length) {
          //           throw new Error(`Cannot find a GeoNames ID for this country: ${refCountry.englishShortName}`);
          //         }
          //
          //         const geoNamesUrl = _.trimRight(filtered[0].object.toString(), '/');
          //         refCountry.geoNamesId = geoNamesUrl.substring(geoNamesUrl.lastIndexOf('/') + 1);
          //
          //         resolve(refCountry);
          //       }).catch((exception) => {
          //         reject(exception);
          //       });
          //     }
          //   });
        }
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
          this.countries = countries;
          return this.countries;
        });
    }

    return Promise.resolve(this.countries);
  }
}

export default Scraper;
