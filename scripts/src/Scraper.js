#!/usr/bin/env node

import 'babel-polyfill';
import _ from 'lodash';
import xray from 'x-ray';

import rdf from 'rdf-ext';
import RdfXmlParser from 'rdf-parser-rdfxml';
rdf.parsers = new rdf.Parsers({
  'application/rdf+xml': RdfXmlParser,
});

import request from 'superagent';
import cheerio from 'cheerio';

import DefaultCategoryMappings from './DefaultCategoryMappings';
import WikidataGeoNamesMappings from './WikidataGeoNamesMappings';
import Iso31662WikipediaMappings from './Iso31662WikipediaMappings';

import stringify from 'streaming-json-stringify';
import fs from 'fs';
import path from 'path';

import debug from 'debug';
import Progress from 'progress';

class Scraper {
  constructor(directoryName = './data', data = {}) {
    this.throttleTime = 250;
    this.progressBar = null;
    this.directoryName = directoryName;
    this.data = data;
  }

  /**
  * getCountryList() scrapes codes and links of countries in ISO 3166-1 from Wikipedia.
  *
  * @access private
  * @return {Promise}
  */
  getCountryList() {
    return new Promise((resolve, reject) => {
      const scraper = xray();

      scraper('https://en.wikipedia.org/wiki/ISO_3166-1',
        'h3:has(#Officially_assigned_code_elements) ~ table.wikitable:first-of-type > tr',
        [{
          isoTwoLetterCountryCode: 'td:nth-child(2)',
          isoThreeLetterCountryCode: 'td:nth-child(3)',
          isoThreeDigitCountryCode: 'td:nth-child(4)',
          wikipediaUri: 'td:nth-child(1) a@href',
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
  * getWikiIds() scrapes the Wikipedia canonical slug of each entity.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  getWikiIds(entities) {
    const promises = entities.map((entity, index) => new Promise((resolve, reject) => {
      if (entity && entity.wikipediaUri) {
        setTimeout(() => {
          const entityReference = entity;
          let slug = _.trimEnd(entityReference.wikipediaUri, '/');
          delete entityReference.wikipediaUri;
          slug = slug.substring(slug.lastIndexOf('/') + 1);

          request
            .get('https://en.wikipedia.org/w/api.php')
            .query({
              action: 'query',
              prop: 'info',
              inprop: 'url',
              redirects: true,
              format: 'json',
              titles: decodeURIComponent(slug),
            })
            .end((error, response) => {
              if (error) {
                reject(error);
              } else {
                // Get the first page of the results.
                _.forEach(response.body.query.pages, (page, id) => {
                  if (id !== '-1') {
                    const canonicalSlug = _.trimEnd(page.canonicalurl, '/');
                    entityReference.wikipediaSlug =
                      canonicalSlug.substring(canonicalSlug.lastIndexOf('/') + 1);
                  }

                  return false;
                });

                if (process.env.NODE_ENV !== 'test') {
                  this.progressBar.tick();
                }

                resolve(entityReference);
              }
            });
        }, this.throttleTime * index);
      } else {
        if (process.env.NODE_ENV !== 'test') {
          this.progressBar.tick();
        }

        resolve(entity);
      }
    }));

    return Promise.all(promises);
  }

  /**
  * setValueWithLanguage() sets the property value with the language of the key on the object.
  *
  * @access private
  * @param {Object} the object to augment
  * @param {string} the language of the property value
  * @param {string} the key of the property to set
  * @param {string} the value to set
  * @return {Object} the reference of the augmented object
  */
  setValueWithLanguage(object, language, key, value) {
    const objectReference = object;

    if (language) {
      objectReference[language] = objectReference[language] || {};

      if (!objectReference[language][key]) {
        objectReference[language][key] = value;
      } else {
        if (_.isString(objectReference[language][key])) {
          objectReference[language][key] = objectReference[language][key].split();
        }
        objectReference[language][key].push(value);
      }
    }

    return objectReference;
  }

  /**
  * getGeoNamesIds() scrapes the GeoNames ID of each entity.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  getGeoNamesIds(entities) {
    const promises = entities.map((entity, index) => new Promise((resolve, reject) => {
      if (entity.wikipediaSlug) {
        setTimeout(() => {
          request
            .get('https://www.wikidata.org/w/api.php')
            .query({
              action: 'wbgetentities',
              sites: 'enwiki',
              props: 'labels|claims',
              format: 'json',
              titles: decodeURIComponent(entity.wikipediaSlug),
            })
            .end((error, response) => {
              if (error) {
                reject(error);
              } else {
                const entityReference = entity;

                // Get the first entity of the results.
                _.forEach(response.body.entities, (wikidata, id) => {
                  if (id !== '-1') {
                    entityReference.wikidataId = id;

                    if (entityReference.wikidataId in WikidataGeoNamesMappings) {
                      if (WikidataGeoNamesMappings[entityReference.wikidataId]) {
                        entityReference.geoNamesId =
                          WikidataGeoNamesMappings[entityReference.wikidataId];
                      }
                    } else {
                      try {
                        entityReference.geoNamesId =
                          wikidata.claims.P1566[0].mainsnak.datavalue.value;
                      } catch (exception) {
                        debug('scraper:error')(
                          'Cannot find a GeoNames ID for ' +
                          `this Wikidata entity: ${entityReference.wikidataId}`
                        );
                      }
                    }

                    _.forEach(wikidata.labels, label => {
                      this.setValueWithLanguage(
                        entityReference,
                        label.language,
                        'wikipediaLabel',
                        label.value
                      );
                    });
                  }

                  return false;
                });

                if (process.env.NODE_ENV !== 'test') {
                  this.progressBar.tick();
                }

                resolve(entityReference);
              }
            });
        }, this.throttleTime * index);
      } else {
        if (process.env.NODE_ENV !== 'test') {
          this.progressBar.tick();
        }

        resolve(entity);
      }
    }));

    return Promise.all(promises);
  }

  /**
  * getGeoNamesData() scrapes the data of each entity from GeoNames.
  *
  * @access private
  * @param {Array} entities
  * @return {Promise} a promise that waits for all promises for entities to be fulfilled
  */
  getGeoNamesData(entities) {
    const promises = entities.map((entity, index) => new Promise((resolve, reject) => {
      if (entity.geoNamesId) {
        setTimeout(() => {
          rdf
            .defaultRequest('get', `http://sws.geonames.org/${entity.geoNamesId}/about.rdf`)
            .then(response => rdf.parsers.parse('application/rdf+xml', response.content))
            .then(graph => {
              const entityReference = entity;

              graph.forEach(triple => {
                const gn = name => `http://www.geonames.org/ontology#${name}`;
                const wgs84 = name => `http://www.w3.org/2003/01/geo/wgs84_pos#${name}`;

                if (triple.predicate.equals(gn('name'))) {
                  entityReference.name = triple.object.toString();
                } else if (triple.predicate.equals(wgs84('lat'))) {
                  entityReference.latitude = parseFloat(triple.object.toString());
                } else if (triple.predicate.equals(wgs84('long'))) {
                  entityReference.longitude = parseFloat(triple.object.toString());
                }

                ['officialName', 'alternateName', 'shortName'].forEach(name => {
                  if (triple.predicate.equals(gn(name))) {
                    this.setValueWithLanguage(
                      entityReference,
                      triple.object.language,
                      name,
                      triple.object.toString()
                    );
                  }
                });
              });

              if (process.env.NODE_ENV !== 'test') {
                this.progressBar.tick();
              }

              resolve(entityReference);
            })
            .catch(exception => {
              reject(exception);
            });

          // The hourly limit of GeoNames is 2000 credits.
        }, this.throttleTime * index + (3600000 * Math.floor(index / 1700)));
      } else {
        if (process.env.NODE_ENV !== 'test') {
          this.progressBar.tick();
        }

        resolve(entity);
      }
    }));

    return Promise.all(promises);
  }

  /**
  * getRegionList() scrapes codes and links of continental and sub-continental regions from UNSD.
  *
  * @access public
  * @param {Array} countries
  * @return {Promise}
  */
  getRegionList(countries) {
    return new Promise((resolve, reject) => {
      request
        .get('http://unstats.un.org/unsd/methods/m49/m49regin.htm')
        .end((error, response) => {
          if (error) {
            reject(error);
          } else {
            // Fix the borken HTML of the UNSD page.
            const text = response.text.replace(/(Saint-Barth[\s\S]+?<\/tr>)/m, '$1<tr>');
            const html = cheerio.load(text);
            const table = html('td.content[width="100%"]>table:nth-of-type(4)');

            const continents = [];
            const regions = [];

            table.find('tr').each((index, element) => {
              const tr = cheerio(element);

              // Break the loop if it's not the first header.
              if (tr.find('td.cheader2').length) {
                return !index;
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
                  wikipediaUri: `https://en.wikipedia.org/wiki/${continent.replace(/\s/g, '_')}`,
                  regions: [],
                };
                continents.push(newContinent);

                return true;
              }

              // Find a sub-continental region.
              let region = tds.eq(1).find('b');
              if (region.length) {
                region = _.trim(region.text());

                // Exception handling for Latin America and the Caribbean
                if (code === '419') {
                  region = 'Community of Latin American and Caribbean States';
                }

                const newRegion = {
                  unM49Code: code,
                  // Rough mapping of names to Wikipedia URIs
                  wikipediaUri: `https://en.wikipedia.org/wiki/${region.replace(/\s/g, '_')}`,
                  continent: _.last(continents),
                  countries: [],
                };
                newRegion.continent.regions.push(newRegion);
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
                country.region = _.last(regions);
                country.region.countries.push(country);
              }

              return true;
            });

            resolve([
              continents,
              regions,
              countries,
              _.flatten(_.map(countries, 'subdivisions')),
            ]);
          }
        });
    });
  }

  /**
  * getSubdivisionList() scrapes codes and links of subdivisions of each country
  * in ISO 3166-2 from Wikipedia.
  *
  * @access private
  * @param {Array} countries
  * @return {Promise}
  */
  getSubdivisionList(countries) {
    const promises = countries.map((country, index) => {
      const countryReference = country;

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          request
            .get(`https://en.wikipedia.org/wiki/ISO_3166-2:${country.isoTwoLetterCountryCode.toUpperCase()}`)
            .end((error, response) => {
              if (error) {
                reject(error);
              } else {
                const html = cheerio.load(response.text);
                const siblings = html('h2:has(#Current_codes)').nextAll();

                const subdivisions = [];

                // For countries without category headings
                let defaultCategory = DefaultCategoryMappings[
                  countryReference.isoTwoLetterCountryCode.toUpperCase()
                ];
                let tableIndex = 0;

                siblings.each((siblingIndex, sibling) => {
                  const element = cheerio(sibling);

                  // Break the loop if the element is <h2>.
                  if (element.is('h2')) {
                    return false;
                  }

                  // Get a default category from the heading.
                  if (!defaultCategory && element.is('h3')) {
                    const heading = element.find('.mw-headline').text();

                    switch (heading) {
                      case 'Chains (of islands)':
                        defaultCategory = 'Chain';
                        break;
                      case 'Municipalities':
                        defaultCategory = 'Municipality';
                        break;
                      case 'Parishes':
                        defaultCategory = 'Parish';
                        break;
                      case 'Counties':
                        // falls through
                      case '47 counties':
                        // Exception handling for Kenya
                        defaultCategory = 'County';
                        break;
                      case 'Autonomous republic':
                        defaultCategory = 'Autonomous republic';
                        break;
                      default:
                        if (_.endsWith(heading, 's')) {
                          defaultCategory = heading.slice(0, -1);
                        }
                    }

                  // Get data from a table.
                  } else if (element.is('table')) {
                    let codeIndex;
                    let categoryIndex;
                    let subdivisionIndex;

                    element.find('th').each((headerIndex, th) => {
                      const header = cheerio(th).text();

                      if (header.match(/Code/i)) {
                        codeIndex = headerIndex + 1;
                      } else if (header.match(/category/i)) {
                        categoryIndex = headerIndex + 1;
                      } else if (header.match(/^(in|parent)/mi)) {
                        subdivisionIndex = headerIndex + 1;
                      }

                      return true;
                    });

                    element.find('tr').each((rowIndex, tr) => {
                      const row = cheerio(tr);

                      const code = _.trim(row.find(`td:nth-child(${codeIndex})`).text())
                                    .toUpperCase();

                      if (
                        code.length &&
                        !_.find(subdivisions, ['isoCountrySubdivisionCode', code])
                      ) {
                        const newSubdivision = {};
                        newSubdivision.country = countryReference;
                        newSubdivision.isoCountrySubdivisionCode = code;
                        newSubdivision.isoSubdivisionCode =
                          newSubdivision.isoCountrySubdivisionCode.split('-').pop();

                        let wikipediaUri = row.find('td a').attr('href');
                        if (_.startsWith(wikipediaUri, '/wiki/File:') ||
                            _.endsWith(wikipediaUri, '_language')) {
                          wikipediaUri = row.find('td a').next().attr('href');
                        }

                        if (code in Iso31662WikipediaMappings) {
                          if (Iso31662WikipediaMappings[code]) {
                            newSubdivision.wikipediaUri = Iso31662WikipediaMappings[code];
                          }
                        } else if (wikipediaUri && !wikipediaUri.match(/action=edit/i)) {
                          newSubdivision.wikipediaUri = `https://en.wikipedia.org${wikipediaUri}`;
                        }

                        if (!newSubdivision.wikipediaUri) {
                          newSubdivision.name =
                            _.trim(row.find(`td:nth-child(${codeIndex + 1})`).text());
                        }

                        newSubdivision.isoSubdivisionCategory =
                          (categoryIndex) ?
                            _.capitalize(_.trim(row.find(`td:nth-child(${categoryIndex})`).text()))
                            : defaultCategory;

                        if (tableIndex > 0 && subdivisionIndex) {
                          let parentSubdivision =
                            row.find(`td:nth-child(${subdivisionIndex}) a`)
                            || row.find(`td:nth-child(${subdivisionIndex})`);
                          parentSubdivision = _.trim(parentSubdivision.first().text());
                          if (parentSubdivision && !parentSubdivision.match(/(&#x2014;|—)/)) {
                            if (parentSubdivision.match(/-/)) {
                              parentSubdivision = parentSubdivision.split('-').pop();
                            }
                            newSubdivision.parentSubdivision =
                              _.find(subdivisions, ['isoSubdivisionCode', parentSubdivision]);

                            newSubdivision.parentSubdivision.subSubdivions =
                              newSubdivision.parentSubdivision.subSubdivions || [];
                            newSubdivision.parentSubdivision.subSubdivions.push(newSubdivision);
                          }
                        }

                        subdivisions.push(newSubdivision);
                      }
                    });

                    tableIndex++;
                  }

                  return true;
                });
                countryReference.subdivisions = subdivisions;

                if (process.env.NODE_ENV !== 'test') {
                  this.progressBar.tick();
                }

                resolve(countryReference);
              }
            });
        }, this.throttleTime * index);
      });
    });

    return Promise.all(promises);
  }

  /**
   * saveFile() saves data into a file under the data directory.
   *
   * @access private
   * @param {String} filename
   * @param {Array} data
   * @param {Object} options
   */
  saveFile(filename, data, options) {
    return new Promise((resolve, reject) => {
      fs.mkdir(this.directoryName, error => {
        if (error && (error.code !== 'EEXIST')) {
          reject(error);
        } else {
          const stringifyReplacer = stringify({
            replacer: (key, value) => {
              if (_.has(options, key)) {
                if (options[key]) {
                  return value[options[key]];
                }

                return undefined;
              }

              return value;
            },
          });

          stringifyReplacer.pipe(fs.createWriteStream(path.join(this.directoryName, filename)));
          data.forEach(item => {
            stringifyReplacer.write(item);
          });
          stringifyReplacer.end();
          stringifyReplacer.on('end', resolve);
          stringifyReplacer.on('error', reject);
        }
      });
    });
  }

  /**
   * loadFile() loads data from a file under the data directory.
   *
   * @access private
   * @param {String} filename
   */
  loadFile(filename) {
    return new Promise((resolve, reject) => {
      const filePath = path.join(this.directoryName, filename);

      fs.access(filePath, fs.R_OK, accessError => {
        if (accessError) {
          reject(accessError);
        } else {
          fs.readFile(filePath, 'utf8', (readError, data) => {
            if (readError) {
              reject(readError);
            } else {
              resolve(JSON.parse(data));
            }
          });
        }
      });
    });
  }

  /**
  * logData() logs data via debug('scraper:log').
  *
  * @access public
  */
  logData(data) {
    const log = debug('scraper:log');

    data.continents.forEach(continent => {
      log(continent.name);
      continent.regions.forEach(region => {
        log(`=> ${region.name}`);
        region.countries.forEach(country => {
          log(`  => ${country.name}`);

          country.subdivisions.forEach(subdivision => {
            let subdivisionName = subdivision.name;
            if (!subdivisionName && subdivision.en) {
              subdivisionName = subdivision.en.wikipediaLabel;
            }
            if (subdivision.parentSubdivision) {
              let parentName = subdivision.parentSubdivision.name;
              if (!parentName && subdivision.parentSubdivision.en) {
                parentName = subdivision.parentSubdivision.en.wikipediaLabel;
              }
              log(`    => ${parentName} / ${subdivisionName}`);
            } else {
              log(`    => ${subdivisionName}`);
            }
          });
        });
      });
    });
  }

  /**
  * getData() scrapes data about countries, and their continents, regions,
  * and principal subdivisions.
  *
  * @access public
  * @return {Promise}
  */
  getData() {
    return this.getCountryList()
      .then(countries => {
        if (process.env.NODE_ENV !== 'test') {
          this.progressBar = new Progress(
            'Subdivisions:  [:bar] :percent :etas',
            { total: countries.length }
          );
        }

        return this.getSubdivisionList(countries);
      })
      .then(countries => this.getRegionList(countries))
      .then(data => {
        if (process.env.NODE_ENV !== 'test') {
          const length = data.reduce((previous, current) => previous + current.length, 0);
          this.progressBar =
            new Progress('Wiki IDs:      [:bar] :percent :etas', { total: length });
        }

        return Promise.all([
          this.getWikiIds(data[0]),
          this.getWikiIds(data[1]),
          this.getWikiIds(data[2]),
          this.getWikiIds(data[3]),
        ]);
      })
      .then(data => {
        if (process.env.NODE_ENV !== 'test') {
          const length = data.reduce((previous, current) => previous + current.length, 0);
          this.progressBar =
            new Progress('GeoNames IDs:  [:bar] :percent :etas', { total: length });
        }

        return Promise.all([
          this.getGeoNamesIds(data[0]),
          this.getGeoNamesIds(data[1]),
          this.getGeoNamesIds(data[2]),
          this.getGeoNamesIds(data[3]),
        ]);
      })
      .then(data => {
        if (process.env.NODE_ENV !== 'test') {
          const length = data.reduce((previous, current) => previous + current.length, 0);
          this.progressBar =
            new Progress('GeoNames Data: [:bar] :percent :etas', { total: length });
        }

        return Promise.all([
          this.getGeoNamesData(data[0]),
          this.getGeoNamesData(data[1]),
          this.getGeoNamesData(data[2]),
          this.getGeoNamesData(data[3]),
        ]);
      })
      .then(data => {
        this.data.continents = data[0];
        this.data.regions = data[1];
        this.data.countries = data[2];
        this.data.subdivisions = data[3];

        return this.data;
      });
  }

  /**
  * saveData() saves scraped data about countries, and their continents, regions,
  * and principal subdivisions into respective files.
  *
  * @access public
  * @return {Promise}
  */
  saveData() {
    return new Promise((resolve, reject) => {
      if (_.isEmpty(this.data)) {
        this.getData().then(data => {
          resolve(data);
        }, error => {
          reject(error);
        });
      } else {
        resolve(this.data);
      }
    }).then(data => Promise.all([
      this.saveFile('continents.json', data.continents, {
        regions: undefined,
      }),
      this.saveFile('regions.json', data.regions, {
        continent: 'unM49Code',
        countries: undefined,
      }),
      this.saveFile('countries.json', data.countries, {
        region: 'unM49Code',
        subdivisions: undefined,
      }),
      this.saveFile('subdivisions.json', data.subdivisions, {
        country: 'isoTwoLetterCountryCode',
        parentSubdivision: 'isoCountrySubdivisionCode',
        subSubdivions: undefined,
      }),
    ]).then(() => this.data));
  }

  /**
  * loadData() loads the scraped data from the files.
  *
  * @access public
  * @return {Promise}
  */
  loadData() {
    return Promise.all([
      this.loadFile('continents.json'),
      this.loadFile('regions.json'),
      this.loadFile('countries.json'),
      this.loadFile('subdivisions.json'),
    ]).then(data => {
      this.data.continents = data[0];
      this.data.regions = data[1];
      this.data.countries = data[2];
      this.data.subdivisions = data[3];

      this.data.continents.forEach(continent => {
        const continentReference = continent;

        continentReference.regions = [];
      });

      this.data.regions.forEach(region => {
        const regionReference = region;

        regionReference.continent = _.find(this.data.continents, { unM49Code: region.continent });
        regionReference.continent.regions.push(regionReference);
        regionReference.countries = [];
      });

      this.data.countries.forEach(country => {
        const countryReference = country;

        if (country.region) {
          countryReference.region = _.find(this.data.regions, { unM49Code: country.region });
          countryReference.region.countries.push(countryReference);
        }

        countryReference.subdivisions = [];
      });

      this.data.subdivisions.forEach(subdivision => {
        const subdivisionReference = subdivision;

        subdivisionReference.country =
          _.find(this.data.countries, { isoTwoLetterCountryCode: subdivision.country });
        subdivisionReference.country.subdivisions.push(subdivisionReference);

        if (subdivision.parentSubdivision) {
          subdivisionReference.parentSubdivision =
            _.find(
              this.data.subdivisions,
              { isoCountrySubdivisionCode: subdivision.parentSubdivision }
            );
          subdivisionReference.parentSubdivision.subSubdivions =
            subdivisionReference.parentSubdivision.subSubdivions || [];
          subdivisionReference.parentSubdivision.subSubdivions.push(subdivisionReference);
        }
      });

      return this.data;
    });
  }
}

if (!module.parent) {
  process.on('unhandledRejection', error => {
    debug('scraper:error')(error);
  });

  const scraper = new Scraper();
  scraper.saveData().then(data => {
    scraper.logData(data);
  });
}

export default Scraper;
