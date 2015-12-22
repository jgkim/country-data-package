import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import dirtyChai from 'dirty-chai';
import nock from 'nock';
import _ from 'lodash';
import Scraper from '../scripts/Scraper';

chai.use(chaiAsPromised);
chai.use(dirtyChai);

Feature('Country Data Scraping',
  'As a data consumer',
  'I want to scrape data about countries from the Web',
  'so that I can re-use the data for other purposes', () => {
    let scraper;
    let promise;

    Scenario('Good Network Connection', () => {
      before(() => {
        scraper = new Scraper();
        if (!nock.isActive()) nock.activate();
      });

      Given('the network connection is okay', () => {
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-1.html`)
          .get('/wiki/Belgium')
          .replyWithFile(200, `${__dirname}/fixtures/BE.html`)
          .get('/wiki/Korea_(Republic_of)')
          .replyWithFile(200, `${__dirname}/fixtures/KR.html`)
          .get('/wiki/United_States_of_America')
          .replyWithFile(200, `${__dirname}/fixtures/US.html`);
      });

      When('the data consumer starts scraping', () => {
        promise = scraper.getCountries();
      });

      Then('data about countries will eventually be returned', () => {
        return promise.then((countries) => {
          expect(countries).to.have.length.of.at.least(3);

          const korea = _.find(countries, { isoTwoLetterCountryCode: 'KR' });
          expect(korea.englishShortName).to.equal('Korea (Republic of)');
          expect(korea.isoThreeLetterCountryCode).to.equal('KOR');
          expect(korea.isoThreeDigitCountryCode).to.equal('410');
          expect(korea.isoCountrySubdivisionCode).to.equal('ISO 3166-2:KR');
          expect(korea.wikipediaSlug).to.equal('South_Korea');
          expect(korea.wikidataId).to.equal('Q884');
        });
      });

      after(() => {
        nock.cleanAll();
        nock.restore();
      });
    });

    Scenario('Bad Network Connection', () => {
      before(() => {
        scraper = new Scraper();
        if (!nock.isActive()) nock.activate();
      });

      Given('the network connection is refused', () => {
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithError('Connection refused');
      });

      When('the data consumer starts scraping', () => {
        promise = scraper.getCountries();
      });

      Then('an error will eventually be returned', () => {
        return expect(promise).to.be.rejectedWith(Error, 'Connection refused');
      });

      after(() => {
        nock.cleanAll();
        nock.restore();
      });
    });
  });
