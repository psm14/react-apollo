import React, { useState, useReducer } from 'react';
import { DocumentNode, GraphQLError } from 'graphql';
import gql from 'graphql-tag';
import { MockedProvider, MockLink } from '@apollo/react-testing';
import { render, cleanup, wait } from '@testing-library/react';
import { useQuery, ApolloProvider } from '@apollo/react-hooks';
import { ApolloClient } from 'apollo-client';
import { ApolloLink, Observable } from 'apollo-link';
import { InMemoryCache } from 'apollo-cache-inmemory';

describe('useQuery Hook', () => {
  const CAR_QUERY: DocumentNode = gql`
    query {
      cars {
        make
        model
        vin
      }
    }
  `;

  const CAR_RESULT_DATA = {
    cars: [
      {
        make: 'Audi',
        model: 'RS8',
        vin: 'DOLLADOLLABILL',
        __typename: 'Car'
      }
    ]
  };

  const CAR_MOCKS = [
    {
      request: {
        query: CAR_QUERY
      },
      result: { data: CAR_RESULT_DATA }
    }
  ];

  afterEach(cleanup);

  describe('General use', () => {
    it('should handle a simple query properly', done => {
      const Component = () => {
        const { data, loading } = useQuery(CAR_QUERY);
        if (!loading) {
          expect(data).toEqual(CAR_RESULT_DATA);
          done();
        }
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );
    });

    it('should keep data as undefined until data is actually returned', done => {
      const Component = () => {
        const { data, loading } = useQuery(CAR_QUERY);
        if (loading) {
          expect(data).toBeUndefined();
        } else {
          expect(data).toEqual(CAR_RESULT_DATA);
          done();
        }
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );
    });

    it('should ensure ObservableQuery fields have a stable identity', async () => {
      let refetchFn: any;
      let fetchMoreFn: any;
      let updateQueryFn: any;
      let startPollingFn: any;
      let stopPollingFn: any;
      let subscribeToMoreFn: any;
      const Component = () => {
        const {
          loading,
          refetch,
          fetchMore,
          updateQuery,
          startPolling,
          stopPolling,
          subscribeToMore
        } = useQuery(CAR_QUERY);
        if (loading) {
          refetchFn = refetch;
          fetchMoreFn = fetchMore;
          updateQueryFn = updateQuery;
          startPollingFn = startPolling;
          stopPollingFn = stopPolling;
          subscribeToMoreFn = subscribeToMore;
        } else {
          expect(refetch).toBe(refetchFn);
          expect(fetchMore).toBe(fetchMoreFn);
          expect(updateQuery).toBe(updateQueryFn);
          expect(startPolling).toBe(startPollingFn);
          expect(stopPolling).toBe(stopPollingFn);
          expect(subscribeToMore).toBe(subscribeToMoreFn);
        }
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );

      await wait();
    });
  });

  describe('Polling', () => {
    it('should support polling', done => {
      let renderCount = 0;
      const Component = () => {
        let { data, loading, stopPolling } = useQuery(CAR_QUERY, {
          pollInterval: 10
        });
        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            break;
          case 1:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            stopPolling();
            setTimeout(() => {
              done();
            }, 10);
            break;
          case 3:
            done.fail('Uh oh - we should have stopped polling!');
            break;
          default:
          // Do nothing
        }
        renderCount += 1;
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );
    });

    it('should stop polling when skip is true', done => {
      let renderCount = 0;
      const Component = () => {
        const [shouldSkip, setShouldSkip] = useState(false);
        let { data, loading } = useQuery(CAR_QUERY, {
          pollInterval: 10,
          skip: shouldSkip
        });

        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            break;
          case 1:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            setShouldSkip(true);
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toBeUndefined();
            setTimeout(() => {
              done();
            }, 10);
            break;
          case 4:
            done.fail('Uh oh - we should have stopped polling!');
            break;
          default:
          // Do nothing
        }
        renderCount += 1;
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );
    });

    it('should stop polling when the component is unmounted', done => {
      const mockLink = new MockLink(CAR_MOCKS);
      const linkRequestSpy = jest.spyOn(mockLink, 'request');
      let renderCount = 0;
      const QueryComponent = ({ unmount }: { unmount: () => void }) => {
        const { data, loading } = useQuery(CAR_QUERY, { pollInterval: 10 });
        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            break;
          case 1:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            expect(linkRequestSpy).toHaveBeenCalledTimes(1);
            break;
          case 2:
            expect(loading).toBeFalsy();
            expect(data).toEqual(CAR_RESULT_DATA);
            expect(linkRequestSpy).toHaveBeenCalledTimes(2);
            unmount();
            break;
          default:
        }
        renderCount += 1;
        return null;
      };

      const Component = () => {
        const [queryMounted, setQueryMounted] = useState(true);
        const unmount = () => setTimeout(() => setQueryMounted(false), 0);
        if (!queryMounted)
          setTimeout(() => {
            expect(linkRequestSpy).toHaveBeenCalledTimes(2);
            done();
          }, 30);
        return <>{queryMounted && <QueryComponent unmount={unmount} />}</>;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS} link={mockLink}>
          <Component />
        </MockedProvider>
      );
    });

    it('should set called to true by default', () => {
      const Component = () => {
        const { loading, called } = useQuery(CAR_QUERY);
        expect(loading).toBeTruthy();
        expect(called).toBeTruthy();
        return null;
      };

      render(
        <MockedProvider mocks={CAR_MOCKS}>
          <Component />
        </MockedProvider>
      );
    });
  });

  describe('Error handling', () => {
    it("should render GraphQLError's", done => {
      const query = gql`
        query TestQuery {
          rates(currency: "USD") {
            rate
          }
        }
      `;

      const mocks = [
        {
          request: { query },
          result: {
            errors: [new GraphQLError('forced error')]
          }
        }
      ];

      const Component = () => {
        const { loading, error } = useQuery(query);
        if (!loading) {
          expect(error).toBeDefined();
          expect(error!.message).toEqual('GraphQL error: forced error');
          done();
        }
        return null;
      };

      render(
        <MockedProvider mocks={mocks}>
          <Component />
        </MockedProvider>
      );
    });

    it('should only call onError callbacks once', done => {
      const query = gql`
        query SomeQuery {
          stuff {
            thing
          }
        }
      `;

      const resultData = { stuff: { thing: 'it!', __typename: 'Stuff' } };

      let callCount = 0;
      const link = new ApolloLink(() => {
        if (!callCount) {
          callCount += 1;
          return new Observable(observer => {
            observer.error(new Error('Oh no!'));
          });
        } else {
          return Observable.of({ data: resultData });
        }
      });

      const client = new ApolloClient({
        link,
        cache: new InMemoryCache()
      });

      const onErrorMock = jest.fn();

      let renderCount = 0;
      const Component = () => {
        const { loading, error, refetch, data, networkStatus } = useQuery(
          query,
          {
            onError: onErrorMock,
            notifyOnNetworkStatusChange: true
          }
        );

        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            break;
          case 1:
            expect(loading).toBeFalsy();
            expect(error).toBeDefined();
            expect(error!.message).toEqual('Network error: Oh no!');
            setTimeout(() => {
              expect(onErrorMock.mock.calls.length).toBe(1);
              refetch();
            });
            break;
          case 2:
            expect(loading).toBeTruthy();
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toEqual(resultData);
            done();
            break;
          default: // Do nothing
        }

        renderCount += 1;
        return null;
      };

      render(
        <ApolloProvider client={client}>
          <Component />
        </ApolloProvider>
      );
    });

    it('should persist errors on re-render if they are still valid', done => {
      const query = gql`
        query SomeQuery {
          stuff {
            thing
          }
        }
      `;

      const mocks = [
        {
          request: { query },
          result: {
            errors: [new GraphQLError('forced error')]
          }
        }
      ];

      let renderCount = 0;
      function App() {
        const [_, forceUpdate] = useReducer(x => x + 1, 0);
        const { loading, error } = useQuery(query);

        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            expect(error).toBeUndefined();
            break;
          case 1:
            expect(error).toBeDefined();
            expect(error!.message).toEqual('GraphQL error: forced error');
            setTimeout(() => {
              forceUpdate(0);
            });
            break;
          case 2:
            expect(error).toBeDefined();
            expect(error!.message).toEqual('GraphQL error: forced error');
            done();
            break;
          default: // Do nothing
        }

        renderCount += 1;
        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <App />
        </MockedProvider>
      );
    });

    it(
      'should persist errors on re-render when inlining onError and/or ' +
        'onCompleted callbacks',
      async () => {
        const query = gql`
          query SomeQuery {
            stuff {
              thing
            }
          }
        `;

        const mocks = [
          {
            request: { query },
            result: {
              errors: [new GraphQLError('forced error')]
            }
          }
        ];

        let renderCount = 0;
        function App() {
          const [_, forceUpdate] = useReducer(x => x + 1, 0);
          const { loading, error } = useQuery(query, {
            onError: () => {},
            onCompleted: () => {}
          });

          switch (renderCount) {
            case 0:
              expect(loading).toBeTruthy();
              expect(error).toBeUndefined();
              break;
            case 1:
              expect(error).toBeDefined();
              expect(error!.message).toEqual('GraphQL error: forced error');
              setTimeout(() => {
                forceUpdate(0);
              });
              break;
            case 2:
              expect(error).toBeDefined();
              expect(error!.message).toEqual('GraphQL error: forced error');
              break;
            default: // Do nothing
          }

          renderCount += 1;
          return null;
        }

        render(
          <MockedProvider mocks={mocks}>
            <App />
          </MockedProvider>
        );

        await wait(() => {
          expect(renderCount).toBe(3);
        });
      }
    );
  });

  describe('Pagination', () => {
    it(
      'should render `fetchMore.updateQuery` updated results with proper ' +
        'loading status, when `notifyOnNetworkStatusChange` is true',
      async () => {
        const carQuery: DocumentNode = gql`
          query cars($limit: Int) {
            cars(limit: $limit) {
              id
              make
              model
              vin
              __typename
            }
          }
        `;

        const carResults = {
          cars: [
            {
              id: 1,
              make: 'Audi',
              model: 'RS8',
              vin: 'DOLLADOLLABILL',
              __typename: 'Car'
            }
          ]
        };

        const moreCarResults = {
          cars: [
            {
              id: 2,
              make: 'Audi',
              model: 'eTron',
              vin: 'TREESRGOOD',
              __typename: 'Car'
            }
          ]
        };

        const mocks = [
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: carResults }
          },
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: moreCarResults }
          }
        ];

        let renderCount = 0;
        function App() {
          const { loading, data, fetchMore } = useQuery(carQuery, {
            variables: { limit: 1 },
            notifyOnNetworkStatusChange: true
          });

          switch (renderCount) {
            case 0:
              expect(loading).toBeTruthy();
              break;
            case 1:
              expect(loading).toBeFalsy();
              expect(data).toEqual(carResults);
              fetchMore({
                variables: {
                  limit: 1
                },
                updateQuery: (prev, { fetchMoreResult }) => ({
                  cars: [...prev.cars, ...fetchMoreResult.cars]
                })
              });
              break;
            case 2:
              expect(loading).toBeTruthy();
              break;
            case 3:
              expect(loading).toBeFalsy();
              expect(data).toEqual({
                cars: [carResults.cars[0], moreCarResults.cars[0]]
              });
              break;
            default:
          }

          renderCount += 1;
          return null;
        }

        render(
          <MockedProvider mocks={mocks}>
            <App />
          </MockedProvider>
        );

        await wait(() => {
          expect(renderCount).toBe(4);
        });
      }
    );

    it(
      'should render `fetchMore.updateQuery` updated results with no ' +
        'loading status, when `notifyOnNetworkStatusChange` is false',
      async () => {
        const carQuery: DocumentNode = gql`
          query cars($limit: Int) {
            cars(limit: $limit) {
              id
              make
              model
              vin
              __typename
            }
          }
        `;

        const carResults = {
          cars: [
            {
              id: 1,
              make: 'Audi',
              model: 'RS8',
              vin: 'DOLLADOLLABILL',
              __typename: 'Car'
            }
          ]
        };

        const moreCarResults = {
          cars: [
            {
              id: 2,
              make: 'Audi',
              model: 'eTron',
              vin: 'TREESRGOOD',
              __typename: 'Car'
            }
          ]
        };

        const mocks = [
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: carResults }
          },
          {
            request: { query: carQuery, variables: { limit: 1 } },
            result: { data: moreCarResults }
          }
        ];

        let renderCount = 0;
        function App() {
          const { loading, data, fetchMore } = useQuery(carQuery, {
            variables: { limit: 1 },
            notifyOnNetworkStatusChange: false
          });

          switch (renderCount) {
            case 0:
              expect(loading).toBeTruthy();
              break;
            case 1:
              expect(loading).toBeFalsy();
              expect(data).toEqual(carResults);
              fetchMore({
                variables: {
                  limit: 1
                },
                updateQuery: (prev, { fetchMoreResult }) => ({
                  cars: [...prev.cars, ...fetchMoreResult.cars]
                })
              });
              break;
            case 2:
              expect(loading).toBeFalsy();
              expect(data).toEqual({
                cars: [carResults.cars[0], moreCarResults.cars[0]]
              });
              break;
            default:
          }

          renderCount += 1;
          return null;
        }

        render(
          <MockedProvider mocks={mocks}>
            <App />
          </MockedProvider>
        );

        await wait(() => {
          expect(renderCount).toBe(3);
        });
      }
    );
  });

  describe('Refetching', () => {
    it('should properly handle refetching with different variables', async () => {
      const carQuery: DocumentNode = gql`
        query cars($id: Int) {
          cars(id: $id) {
            id
            make
            model
            vin
            __typename
          }
        }
      `;

      const carData1 = {
        cars: [
          {
            id: 1,
            make: 'Audi',
            model: 'RS8',
            vin: 'DOLLADOLLABILL',
            __typename: 'Car'
          }
        ]
      };

      const carData2 = {
        cars: [
          {
            id: 2,
            make: 'Audi',
            model: 'eTron',
            vin: 'TREESRGOOD',
            __typename: 'Car'
          }
        ]
      };

      const mocks = [
        {
          request: { query: carQuery, variables: { id: 1 } },
          result: { data: carData1 }
        },
        {
          request: { query: carQuery, variables: { id: 2 } },
          result: { data: carData2 }
        },
        {
          request: { query: carQuery, variables: { id: 1 } },
          result: { data: carData1 }
        }
      ];

      let renderCount = 0;
      function App() {
        const { loading, data, refetch } = useQuery(carQuery, {
          variables: { id: 1 }
        });

        switch (renderCount) {
          case 0:
            expect(loading).toBeTruthy();
            break;
          case 1:
            expect(loading).toBeFalsy();
            expect(data).toEqual(carData1);
            refetch({ id: 2 });
            break;
          case 2:
            expect(loading).toBeTruthy();
            break;
          case 3:
            expect(loading).toBeFalsy();
            expect(data).toEqual(carData2);
            refetch({ id: 1 });
            break;
          case 4:
            expect(loading).toBeTruthy();
            break;
          case 5:
            expect(loading).toBeFalsy();
            expect(data).toEqual(carData1);
            break;
          default:
        }

        renderCount += 1;
        return null;
      }

      render(
        <MockedProvider mocks={mocks}>
          <App />
        </MockedProvider>
      );

      await wait(() => {
        expect(renderCount).toBe(6);
      });
    });
  });
});
