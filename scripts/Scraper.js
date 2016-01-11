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

import request from 'superagent';
import cheerio from 'cheerio';

class Scraper {
  constructor() {
    this.data = {};
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
  * _getWikiIds() scrapes the Wikipedia canonical slug and the Wikidata ID of each entity.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  _getWikiIds(entities) {
    const promises = [];

    entities.map((entity) => {
      promises.push(new Promise((resolve, reject) => {
        const scraper = xray();
        scraper(entity._wikipediaUri, {
          wikipediaSlug: 'link[rel="canonical"]@href',
          wikidataId: '#t-wikibase > a@href',
        })((error, data) => {
          if (error) {
            reject(error);
          } else {
            const entityReference = entity;
            delete entityReference._wikipediaUri;

            const wikipediaSlug = _.trimRight(data.wikipediaSlug, '/');
            entityReference.wikipediaSlug = wikipediaSlug.substring(wikipediaSlug.lastIndexOf('/') + 1);

            const wikidataId = _.trimRight(data.wikidataId, '/');
            entityReference.wikidataId = wikidataId.substring(wikidataId.lastIndexOf('/') + 1);

            resolve(entityReference);
          }
        });
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _getGeoNamesIds() scrapes the GeoNames ID of each entity.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  _getGeoNamesIds(entities) {
    const promises = [];

    entities.map((entity) => {
      promises.push(new Promise((resolve, reject) => {
        const entityReference = entity;

        // Exception handling for Taiwan (cf. https://en.wikipedia.org/wiki/ISO_3166-1#cite_note-18)
        if (entityReference.wikidataId === 'Q7676514') {
          entityReference.geoNamesId = '1668284';
          resolve(entityReference);
        // Exception handling for Americas (cf. https://www.wikidata.org/w/index.php?title=Q828&oldid=289568892)
        } else if (entityReference.wikidataId === 'Q828') {
          entityReference.geoNamesId = '10861432';
          resolve(entityReference);
        } else {
          // TODO: Need to use Wikidata.org to get Wikipedia labels easily.
          const dbpediaGraphUri = 'http://wikidata.dbpedia.org';
          const dbpediaUri = `${dbpediaGraphUri}/resource/${entityReference.wikidataId}`;
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
              throw new Error(`Cannot find a GeoNames ID for this Wikidata entity: ${entityReference.wikidataId}`);
            }

            const geoNamesUrl = _.trimRight(filtered[0].object.toString(), '/');
            entityReference.geoNamesId = geoNamesUrl.substring(geoNamesUrl.lastIndexOf('/') + 1);

            resolve(entityReference);
          }).catch((exception) => {
            reject(exception);
          });
        }
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _getGeoNamesData() scrapes the data of each entity from GeoNames.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  _getGeoNamesData(entities) {
    const promises = [];

    entities.map((entity) => {
      promises.push(new Promise((resolve, reject) => {
        const entityReference = entity;
        const geoNamesUri = `http://sws.geonames.org/${entityReference.geoNamesId}/`;

        rdf.defaultRequest('get', `${geoNamesUri}about.rdf`).then((response) => {
          return rdf.parsers.parse('application/rdf+xml', response.content);
        }).then((graph) => {
          graph.forEach((triple) => {
            const gn = (name) => { return `http://www.geonames.org/ontology#${name}`; };
            const wgs84 = (name) => { return `http://www.w3.org/2003/01/geo/wgs84_pos#${name}`; };

            if (triple.predicate.equals(gn('name'))) {
              entityReference.name = triple.object.toString();
            } else if (triple.predicate.equals(wgs84('lat'))) {
              entityReference.latitude = parseFloat(triple.object.toString());
            } else if (triple.predicate.equals(wgs84('long'))) {
              entityReference.longitude = parseFloat(triple.object.toString());
            }

            ['officialName', 'alternateName', 'shortName'].forEach((name) => {
              if (triple.predicate.equals(gn(name))) {
                if (triple.object.language) {
                  entityReference[triple.object.language] = entityReference[triple.object.language] || {};
                  if (!entityReference[triple.object.language][name]) {
                    entityReference[triple.object.language][name] = triple.object.toString();
                  } else {
                    if (_.isString(entityReference[triple.object.language][name])) {
                      entityReference[triple.object.language][name] = entityReference[triple.object.language][name].split();
                    }
                    entityReference[triple.object.language][name].push(triple.object.toString());
                  }
                }
              }
            });
          });

          resolve(entityReference);
        }).catch((exception) => {
          reject(exception);
        });
      }));
    });

    return Promise.all(promises);
  }

  /**
  * _getRegionList() scrapes names and codes of continental and sub-continental regions from UNSD.
  *
  * @access public
  * @return {Promise}
  */
  _getRegionList(countries) {
    return new Promise((resolve, reject) => {
      request
        .get('http://unstats.un.org/unsd/methods/m49/m49regin.htm')
        .end((error, response) => {
          if (error) {
            reject(error);
          } else {
            // Fix the borken HTML of the UNSD page.
            const text = response.text.replace(/(Saint\-Barth[\s\S]+?<\/tr>)/m, '$1<tr>');
            const html = cheerio.load(text);
            const table = html('td.content[width="100%"]>table:nth-of-type(4)');

            const continents = [];
            const regions = [];

            table.find('tr').each((index, element) => {
              const tr = cheerio(element);

              // Break the loop if it's not the first header.
              if (tr.find('td.cheader2').length) {
                return (index) ? false : true;
              }

              const tds = tr.find('td');
              const code = _.trim(tds.eq(0).text());
              // Skip the row if it's empty.
              if (!code) return true;

              // Find a continental region.
              let continent = tds.eq(1).find('h3 b');
              if (continent.length) {
                const span = continent.find('span.content');
                if (span.length) {
                  continent = span;
                }
                continent = _.trim(continent.text());

                const newContinent = {
                  unM49Code: code,
                  // Rough mapping of names to Wikipedia URIs
                  _wikipediaUri: `https://en.wikipedia.org/wiki/${continent.replace(' ', '_')}`,
                };
                continents.push(newContinent);

                return true;
              }

              // Find a sub-continental region.
              let region = tds.eq(1).find('b');
              if (region.length) {
                region = _.trim(region.text());

                const newRegion = {
                  unM49Code: code,
                  // Rough mapping of names to Wikipedia URIs
                  _wikipediaUri: `https://en.wikipedia.org/wiki/${region.replace(' ', '_')}`,
                  continent: _.last(continents),
                };
                regions.push(newRegion);

                return true;
              }

              /*
               * ISO 3166-1 numeric codes are similar to the three-digit country codes
               * developed and maintained by the United Nations Statistics Division,
               * from which they originate in its UN M.49 standard.
               */
              const country = _.find(countries, { isoThreeDigitCountryCode: code });
              if (country) {
                country.continent = _.last(continents);
                country.region = _.last(regions);
              }
            });

            resolve({ continents, regions, countries });
          }
        });
    });
  }

  /**
  * getData() scrapes data about countries, and their continents, regions, and principal subdivisions.
  *
  * @access public
  * @return {Promise}
  */
  getData() {
    if (_.isEmpty(this.data)) {
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
          return this._getRegionList(countries);
        })
        .then((data) => {
          this.data.countries = data.countries;

          return Promise.all([
            this._getWikiIds(data.continents),
            this._getWikiIds(data.regions),
          ]);
        })
        .then((data) => {
          return Promise.all([
            this._getGeoNamesIds(data[0]),
            this._getGeoNamesIds(data[1]),
          ]);
        })
        .then((data) => {
          return Promise.all([
            this._getGeoNamesData(data[0]),
            this._getGeoNamesData(data[1]),
          ]);
        })
        .then((data) => {
          this.data.continents = data[0];
          this.data.regions = data[1];

          return this.data;
        });
    }

    return Promise.resolve(this.data);
  }
}

export default Scraper;
