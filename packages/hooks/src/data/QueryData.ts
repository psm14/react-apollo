import {
  ApolloQueryResult,
  ObservableQuery,
  ApolloError,
  NetworkStatus,
  FetchMoreOptions,
  FetchMoreQueryOptions,
  UpdateQueryOptions,
  SubscribeToMoreOptions
} from 'apollo-client';
import { equal as isEqual } from '@wry/equality';
import {
  ApolloContextValue,
  DocumentType,
  QueryResult,
  ObservableQueryFields
} from '@apollo/react-common';

import {
  QueryPreviousData,
  QueryOptions,
  QueryCurrentObservable,
  QueryTuple,
  QueryLazyOptions
} from '../types';
import { OperationData } from './OperationData';

export class QueryData<TData, TVariables> extends OperationData {
  private previousData: QueryPreviousData<TData, TVariables> = {};
  private currentObservable: QueryCurrentObservable<TData, TVariables> = {};
  private forceUpdate: any;

  private runLazy: boolean = false;
  private lazyOptions?: QueryLazyOptions<TVariables>;

  constructor({
    options,
    context,
    forceUpdate
  }: {
    options: QueryOptions<TData, TVariables>;
    context: ApolloContextValue;
    forceUpdate: any;
  }) {
    super(options, context);
    this.forceUpdate = forceUpdate;
  }

  public execute(): QueryResult<TData, TVariables> {
    this.refreshClient();

    const { skip, query, ssr } = this.getOptions();
    if (skip || query !== this.previousData.query) {
      this.removeQuerySubscription();
      this.previousData.query = query;
    }

    this.updateObservableQuery();

    if (this.isMounted) this.startQuerySubscription();

    const ssrDisabled = ssr === false;

    return this.getExecuteSsrResult(ssrDisabled) || this.getExecuteResult();
  }

  public executeLazy(): QueryTuple<TData, TVariables> {
    return !this.runLazy
      ? [
          this.runLazyQuery,
          {
            loading: false,
            networkStatus: NetworkStatus.ready,
            called: false,
            data: undefined
          } as QueryResult<TData, TVariables>
        ]
      : [this.runLazyQuery, this.execute()];
  }

  // For server-side rendering
  public fetchData(): Promise<ApolloQueryResult<any>> | boolean {
    const options = this.getOptions();
    if (options.skip || options.ssr === false) return false;

    // currentObservable.query is already assigned the registered SSR observable in initializeObservableQuery.
    const obs = this.currentObservable.query!;
    const currentResult = obs.getCurrentResult();
    return currentResult.loading ? obs.result() : false;
  }

  public afterExecute({ lazy = false }: { lazy?: boolean } = {}) {
    this.isMounted = true;
    if (!lazy || this.runLazy) {
      this.handleErrorOrCompleted();

      // When the component is done rendering stored query errors, we'll
      // remove those errors from the `ObservableQuery` query store, so they
      // aren't re-displayed on subsequent (potentially error free)
      // requests/responses.
      setTimeout(() => {
        this.currentObservable.query &&
          this.currentObservable.query.resetQueryStoreErrors();
      });
    }

    return this.unmount.bind(this);
  }

  public cleanup() {
    this.removeQuerySubscription();
    delete this.currentObservable.query;
    delete this.previousData.result;
  }

  public getOptions() {
    const options = super.getOptions();
    const lazyOptions = this.lazyOptions || {};
    const updatedOptions = {
      ...options,
      variables: {
        ...options.variables,
        ...lazyOptions.variables
      },
      context: {
        ...options.context,
        ...lazyOptions.context
      }
    };

    // skip is not supported when using lazy query execution.
    if (this.runLazy) {
      delete updatedOptions.skip;
    }

    return updatedOptions;
  }

  private runLazyQuery = (options?: QueryLazyOptions<TVariables>) => {
    this.cleanup();

    this.runLazy = true;
    this.lazyOptions = options;
    this.forceUpdate();
  };

  private getExecuteResult = (): QueryResult<TData, TVariables> => {
    const result = this.getQueryResult();
    this.startQuerySubscription();
    return result;
  };

  private getExecuteSsrResult(ssrDisabled: boolean) {
    let result;

    if (this.context && this.context.renderPromises) {
      const ssrLoading = {
        loading: true,
        networkStatus: NetworkStatus.loading,
        called: true,
        data: undefined
      };

      // SSR is disabled, so just return the loading event and leave it in that state.
      if (ssrDisabled) {
        return ssrLoading;
      }

      result = this.context.renderPromises.addQueryPromise(
        this,
        this.getExecuteResult
      );
      if (!result) {
        result = ssrLoading as QueryResult<TData, TVariables>;
      }
    }

    return result;
  }

  private prepareObservableQueryOptions() {
    const options = this.getOptions();
    this.verifyDocumentType(options.query, DocumentType.Query);
    const displayName = options.displayName || 'Query';

    // Set the fetchPolicy to cache-first for network-only and cache-and-network
    // fetches for server side renders.
    if (
      this.context &&
      this.context.renderPromises &&
      (options.fetchPolicy === 'network-only' ||
        options.fetchPolicy === 'cache-and-network')
    ) {
      options.fetchPolicy = 'cache-first';
    }

    return {
      ...options,
      displayName,
      context: options.context || {},
      metadata: { reactComponent: { displayName } }
    };
  }

  private initializeObservableQuery() {
    // See if there is an existing observable that was used to fetch the same
    // data and if so, use it instead since it will contain the proper queryId
    // to fetch the result set. This is used during SSR.
    if (this.context && this.context.renderPromises) {
      this.currentObservable.query = this.context.renderPromises.getSSRObservable(
        this.getOptions()
      );
    }

    if (!this.currentObservable.query) {
      const observableQueryOptions = this.prepareObservableQueryOptions();
      this.previousData.observableQueryOptions = {
        ...observableQueryOptions,
        children: null
      };
      this.currentObservable.query = this.refreshClient().client.watchQuery(
        observableQueryOptions
      );

      if (this.context && this.context.renderPromises) {
        this.context.renderPromises.registerSSRObservable(
          this.currentObservable.query,
          observableQueryOptions
        );
      }
    }
  }

  private updateObservableQuery() {
    // If we skipped initially, we may not have yet created the observable
    if (!this.currentObservable.query) {
      this.initializeObservableQuery();
      return;
    }

    const newObservableQueryOptions = {
      ...this.prepareObservableQueryOptions(),
      children: null
    };

    if (
      !isEqual(
        newObservableQueryOptions,
        this.previousData.observableQueryOptions
      )
    ) {
      this.previousData.observableQueryOptions = newObservableQueryOptions;
      this.currentObservable
        .query!.setOptions(newObservableQueryOptions)
        // The error will be passed to the child container, so we don't
        // need to log it here. We could conceivably log something if
        // an option was set. OTOH we don't log errors w/ the original
        // query. See https://github.com/apollostack/react-apollo/issues/404
        .catch(() => {});
    }
  }

  private startQuerySubscription() {
    if (this.currentObservable.subscription || this.getOptions().skip) return;

    const obsQuery = this.currentObservable.query!;
    this.currentObservable.subscription = obsQuery.subscribe({
      next: ({ loading, networkStatus, data }) => {
        const previousResult = this.previousData.result;

        if (previousResult) {
          // Calls to `ObservableQuery.fetchMore` return a result before the
          // `updateQuery` function fully finishes. This can lead to an
          // extra un-necessary re-render since the initially returned data is
          // the same as data that has already been rendered. We'll
          // prevent the un-necessary render from happening, making sure
          // `fetchMore` results are only rendered when `updateQuery` has
          // completed.
          if (
            previousResult.loading &&
            previousResult.networkStatus === NetworkStatus.fetchMore &&
            isEqual(previousResult.data, data)
          ) {
            return;
          }

          // Make sure we're not attempting to re-render similar results
          if (
            previousResult.loading === loading &&
            previousResult.networkStatus === networkStatus &&
            isEqual(previousResult.data, data)
          ) {
            return;
          }
        }

        this.forceUpdate();
      },
      error: error => {
        this.resubscribeToQuery();
        if (!error.hasOwnProperty('graphQLErrors')) throw error;
        if (!isEqual(error, this.previousData.error)) {
          this.previousData.error = error;
          this.forceUpdate();
        }
      }
    });
  }

  private resubscribeToQuery() {
    this.removeQuerySubscription();

    // Unfortunately, if `lastError` is set in the current
    // `observableQuery` when the subscription is re-created,
    // the subscription will immediately receive the error, which will
    // cause it to terminate again. To avoid this, we first clear
    // the last error/result from the `observableQuery` before re-starting
    // the subscription, and restore it afterwards (so the subscription
    // has a chance to stay open).
    const lastError = this.currentObservable.query!.getLastError();
    const lastResult = this.currentObservable.query!.getLastResult();
    this.currentObservable.query!.resetLastResults();
    this.startQuerySubscription();
    Object.assign(this.currentObservable.query!, {
      lastError,
      lastResult
    });
  }

  private getQueryResult(): QueryResult<TData, TVariables> {
    let result: any = this.observableQueryFields();
    const options = this.getOptions();

    // When skipping a query (ie. we're not querying for data but still want
    // to render children), make sure the `data` is cleared out and
    // `loading` is set to `false` (since we aren't loading anything).
    if (options.skip) {
      result = {
        ...result,
        data: undefined,
        error: undefined,
        loading: false,
        called: true
      };
    } else {
      // Fetch the current result (if any) from the store.
      const currentResult = this.currentObservable.query!.getCurrentResult();
      const { loading, partial, networkStatus, errors } = currentResult;
      let { error, data } = currentResult;

      // Until a set naming convention for networkError and graphQLErrors is
      // decided upon, we map errors (graphQLErrors) to the error options.
      if (errors && errors.length > 0) {
        error = new ApolloError({ graphQLErrors: errors });
      }

      result = {
        ...result,
        loading,
        networkStatus,
        error,
        called: true
      };

      if (loading) {
        const previousData =
          this.previousData.result && this.previousData.result.data;
        result.data =
          previousData && data
            ? {
                ...previousData,
                ...data
              }
            : previousData || data;
      } else if (error) {
        Object.assign(result, {
          data: (this.currentObservable.query!.getLastResult() || ({} as any))
            .data
        });
      } else {
        const { fetchPolicy } = this.currentObservable.query!.options;
        const { partialRefetch } = options;
        if (
          partialRefetch &&
          !data &&
          partial &&
          fetchPolicy !== 'cache-only'
        ) {
          // When a `Query` component is mounted, and a mutation is executed
          // that returns the same ID as the mounted `Query`, but has less
          // fields in its result, Apollo Client's `QueryManager` returns the
          // data as `undefined` since a hit can't be found in the cache.
          // This can lead to application errors when the UI elements rendered by
          // the original `Query` component are expecting certain data values to
          // exist, and they're all of a sudden stripped away. To help avoid
          // this we'll attempt to refetch the `Query` data.
          Object.assign(result, {
            loading: true,
            networkStatus: NetworkStatus.loading
          });
          result.refetch();
          return result;
        }

        result.data = data;
      }
    }

    result.client = this.client;
    this.previousData.loading =
      (this.previousData.result && this.previousData.result.loading) || false;
    this.previousData.result = result;
    return result;
  }

  private handleErrorOrCompleted() {
    if (this.currentObservable.query) {
      const {
        data,
        loading,
        error
      } = this.currentObservable.query!.getCurrentResult();

      if (!loading) {
        const { query, variables, onCompleted, onError } = this.getOptions();

        // No changes, so we won't call onError/onCompleted.
        if (
          this.previousOptions &&
          !this.previousData.loading &&
          isEqual(this.previousOptions.query, query) &&
          isEqual(this.previousOptions.variables, variables)
        ) {
          return;
        }

        if (onCompleted && !error) {
          onCompleted(data);
        } else if (onError && error) {
          onError(error);
        }
      }
    }
  }

  private removeQuerySubscription() {
    if (this.currentObservable.subscription) {
      this.currentObservable.subscription.unsubscribe();
      delete this.currentObservable.subscription;
    }
  }

  private obsRefetch = (variables?: TVariables) =>
    this.currentObservable.query!.refetch(variables);

  private obsFetchMore = <K extends keyof TVariables>(
    fetchMoreOptions: FetchMoreQueryOptions<TVariables, K> &
      FetchMoreOptions<TData, TVariables>
  ) => this.currentObservable.query!.fetchMore(fetchMoreOptions);

  private obsUpdateQuery = <TVars = TVariables>(
    mapFn: (
      previousQueryResult: TData,
      options: UpdateQueryOptions<TVars>
    ) => TData
  ) => this.currentObservable.query!.updateQuery(mapFn);

  private obsStartPolling = (pollInterval: number) =>
    this.currentObservable.query!.startPolling(pollInterval);

  private obsStopPolling = () => this.currentObservable.query!.stopPolling();

  private obsSubscribeToMore = <
    TSubscriptionData = TData,
    TSubscriptionVariables = TVariables
  >(
    options: SubscribeToMoreOptions<
      TData,
      TSubscriptionVariables,
      TSubscriptionData
    >
  ) => this.currentObservable.query!.subscribeToMore(options);

  private observableQueryFields() {
    const observable = this.currentObservable.query!;
    return {
      variables: observable.variables,
      refetch: this.obsRefetch,
      fetchMore: this.obsFetchMore,
      updateQuery: this.obsUpdateQuery,
      startPolling: this.obsStartPolling,
      stopPolling: this.obsStopPolling,
      subscribeToMore: this.obsSubscribeToMore
    } as ObservableQueryFields<TData, TVariables>;
  }
}
