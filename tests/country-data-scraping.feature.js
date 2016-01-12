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

    Scenario('Connected Networks', () => {
      before(() => {
        scraper = new Scraper();
        if (!nock.isActive()) nock.activate();
      });

      Given('the network connection is okay', () => {
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithFile(200, `${__dirname}/fixtures/ISO_3166-1.html`);

        nock('http://unstats.un.org')
          .get('/unsd/methods/m49/m49regin.htm')
          .replyWithFile(200, `${__dirname}/fixtures/UNSD.html`);

        nock('https://en.wikipedia.org')
          .get('/wiki/Belgium')
          .replyWithFile(200, `${__dirname}/fixtures/BE.html`)
          .get('/wiki/Korea_(Republic_of)')
          .replyWithFile(200, `${__dirname}/fixtures/KR.html`)
          .get('/wiki/United_States_of_America')
          .replyWithFile(200, `${__dirname}/fixtures/US.html`)
          .get('/wiki/Europe')
          .replyWithFile(200, `${__dirname}/fixtures/Europe.html`)
          .get('/wiki/Asia')
          .replyWithFile(200, `${__dirname}/fixtures/Asia.html`)
          .get('/wiki/Americas')
          .replyWithFile(200, `${__dirname}/fixtures/Americas.html`)
          .get('/wiki/Western_Europe')
          .replyWithFile(200, `${__dirname}/fixtures/Western_Europe.html`)
          .get('/wiki/Eastern_Asia')
          .replyWithFile(200, `${__dirname}/fixtures/Eastern_Asia.html`)
          .get('/wiki/Northern_America')
          .replyWithFile(200, `${__dirname}/fixtures/Northern_America.html`);

        nock('https://www.wikidata.org')
          .defaultReplyHeaders({
            'Content-Type': 'application/json',
          })
          .get('/wiki/Special:EntityData/Q30.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q30.json`)
          .get('/wiki/Special:EntityData/Q884.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q884.json`)
          .get('/wiki/Special:EntityData/Q31.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q31.json`)
          .get('/wiki/Special:EntityData/Q46.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q46.json`)
          .get('/wiki/Special:EntityData/Q48.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q48.json`)
          .get('/wiki/Special:EntityData/Q828.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q828.json`)
          .get('/wiki/Special:EntityData/Q2017699.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q2017699.json`)
          .get('/wiki/Special:EntityData/Q27231.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q27231.json`)
          .get('/wiki/Special:EntityData/Q27496.json')
          .replyWithFile(200, `${__dirname}/fixtures/Q27496.json`);

        nock('http://sws.geonames.org')
          .defaultReplyHeaders({
            'Content-Type': 'application/rdf+xml',
          })
          .get('/2802361/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/2802361.rdf`)
          .get('/1835841/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/1835841.rdf`)
          .get('/6252001/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/6252001.rdf`)
          .get('/6255148/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/6255148.rdf`)
          .get('/6255147/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/6255147.rdf`)
          .get('/10861432/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/10861432.rdf`)
          .get('/7729890/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/7729890.rdf`)
          .get('/7729894/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/7729894.rdf`)
          .get('/9408659/about.rdf')
          .replyWithFile(200, `${__dirname}/fixtures/9408659.rdf`);
      });

      When('the data consumer starts scraping', () => {
        promise = scraper.getData();
      });

      Then('data about countries will eventually be returned', () => {
        return promise.then((data) => {
          expect(data.continents).to.have.length.of.at.least(3);
          expect(data.regions).to.have.length.of.at.least(3);
          expect(data.countries).to.have.length.of.at.least(3);

          const asia = _.find(data.continents, { unM49Code: '142' });
          expect(asia.wikipediaSlug).to.equal('Asia');
          expect(asia.wikidataId).to.equal('Q48');
          expect(asia.geoNamesId).to.equal('6255147');
          expect(asia.name).to.equal('Asia');
          expect(asia.en.officialName).to.equal('Asia');
          expect(asia.ko.officialName).to.equal('아시아');
          expect(asia.en.wikipediaLabel).to.equal('Asia');
          expect(asia.ko.wikipediaLabel).to.equal('아시아');
          expect(asia.latitude).to.equal(29.84064);
          expect(asia.longitude).to.equal(89.29688);

          const easternAsia = _.find(data.regions, { unM49Code: '030' });
          expect(easternAsia.continent).to.equal(asia);
          expect(easternAsia.wikipediaSlug).to.equal('East_Asia');
          expect(easternAsia.wikidataId).to.equal('Q27231');
          expect(easternAsia.geoNamesId).to.equal('7729894');
          expect(easternAsia.name).to.equal('Eastern Asia');
          expect(easternAsia.en.wikipediaLabel).to.equal('East Asia');
          expect(easternAsia.ko.wikipediaLabel).to.equal('동아시아');
          expect(easternAsia.latitude).to.equal(32.24997);
          expect(easternAsia.longitude).to.equal(114.60938);

          const kr = _.find(data.countries, { isoTwoLetterCountryCode: 'KR' });
          expect(kr.continent).to.equal(asia);
          expect(kr.region).to.equal(easternAsia);
          expect(kr.isoThreeLetterCountryCode).to.equal('KOR');
          expect(kr.isoThreeDigitCountryCode).to.equal('410');
          expect(kr.isoCountrySubdivisionCode).to.equal('ISO 3166-2:KR');
          expect(kr.wikipediaSlug).to.equal('South_Korea');
          expect(kr.wikidataId).to.equal('Q884');
          expect(kr.geoNamesId).to.equal('1835841');
          expect(kr.name).to.equal('South Korea');
          expect(kr.en.officialName).to.equal('Republic of Korea');
          expect(kr.ko.officialName).to.equal('대한민국');
          expect(kr.ko.alternateName).to.include('한국');
          expect(kr.en.shortName).to.equal('South Korea');
          expect(kr.en.wikipediaLabel).to.equal('South Korea');
          expect(kr.ko.wikipediaLabel).to.equal('대한민국');
          expect(kr.latitude).to.equal(36.5);
          expect(kr.longitude).to.equal(127.75);
        });
      });

      after(() => {
        nock.cleanAll();
        nock.restore();
      });
    });

    Scenario('Disconnected Networks', () => {
      const previousNockOff = process.env.NOCK_OFF;

      before(() => {
        scraper = new Scraper();

        process.env.NOCK_OFF = false;
        if (!nock.isActive()) nock.activate();
      });

      Given('the network connection is refused', () => {
        nock('https://en.wikipedia.org')
          .get('/wiki/ISO_3166-1')
          .replyWithError('Connection refused');
      });

      When('the data consumer starts scraping', () => {
        promise = scraper.getData();
      });

      Then('an error will eventually be returned', () => {
        return expect(promise).to.be.rejectedWith(Error, 'Connection refused');
      });

      after(() => {
        nock.cleanAll();
        nock.restore();
        process.env.NOCK_OFF = previousNockOff;
      });
    });
  });
